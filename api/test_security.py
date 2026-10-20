"""Regression tests for authentication, upload quotas, and public controls."""
import datetime as dt
import time
import unittest
from unittest.mock import patch, MagicMock

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import presentation_router


class SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
        now = dt.datetime.now(dt.timezone.utc)
        cls.cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                    .public_key(cls.key.public_key()).serial_number(1)
                    .not_valid_before(now - dt.timedelta(days=1))
                    .not_valid_after(now + dt.timedelta(days=1))
                    .sign(cls.key, hashes.SHA256()).public_bytes(serialization.Encoding.PEM).decode())

    def claims(self, **changes):
        now = int(time.time())
        claims = dict(aud="trusted-project", iss="https://securetoken.google.com/trusted-project",
                      sub="user-one", user_id="user-one", iat=now, exp=now + 3600, auth_time=now)
        return {**claims, **changes}

    def decode(self, claims, key=None):
        token = jwt.encode(claims, key or self.key, algorithm="RS256", headers={"kid": "test"})
        with patch.object(main, "FIREBASE_PROJECT_ID", "trusted-project"), patch.object(main, "_fetch_firebase_certs", return_value={"test": self.cert}):
            return main._decode_firebase_token(token)

    def test_valid_project_token_works(self):
        self.assertEqual(self.decode(self.claims())["sub"], "user-one")

    def test_foreign_project_admin_claim_rejected(self):
        with self.assertRaises(HTTPException) as error:
            self.decode(self.claims(aud="attacker", iss="https://securetoken.google.com/attacker", role="admin"))
        self.assertEqual(error.exception.status_code, 401)

    def test_expired_invalid_and_inconsistent_tokens_rejected(self):
        cases = [self.claims(exp=int(time.time()) - 1), self.claims(user_id="different-user"), self.claims(auth_time=int(time.time()) + 3600)]
        missing = self.claims()
        del missing["exp"]
        cases.append(missing)
        for claims in cases:
            with self.subTest(claims=claims), self.assertRaises(HTTPException):
                self.decode(claims)
        with self.assertRaises(HTTPException):
            self.decode(self.claims(), rsa.generate_private_key(public_exponent=65537, key_size=2048))

    def test_identity_headers_do_not_authenticate(self):
        with self.assertRaises(HTTPException):
            main.get_user(None, authorization=None, x_user_id="admin", x_user_email="admin@example.org")

    def test_private_endpoints_reject_anonymous_requests(self):
        client = TestClient(main.app)
        for path in ["/admin/jobs", "/admin/system", "/user-jobs", "/jobs/11111111-1111-4111-8111-111111111111/results"]:
            self.assertEqual(client.get(path).status_code, 401, path)
        for path in ["/docs", "/openapi.json", "/presentation/status"]:
            self.assertEqual(client.get(path).status_code, 404, path)
        self.assertEqual(client.get("/health").json(), {"ok": True})
        with patch.object(main.httpx, "AsyncClient") as upstream:
            self.assertEqual(client.post("/chat/cleanup").status_code, 200)
            upstream.assert_not_called()

    def test_default_presentation_secret_disabled(self):
        with patch.object(presentation_router, "PRESENTATION_TOKEN", ""), self.assertRaises(HTTPException):
            presentation_router.require_presentation_token("Bearer ")

    def test_oversize_multipart_cannot_be_completed(self):
        session = {"state": "uploading", "size": 10, "part_size": 10}
        parts = [{"PartNumber": 1, "ETag": "tag", "Size": 100}]
        request = main.MPCompleteIn(uploadId="test", key="test/input.fq", parts=[{"PartNumber": 1, "ETag": "tag"}])
        with patch.object(main, "_authorized_upload_session", return_value=session), patch.object(main, "_list_uploaded_parts", return_value=parts), patch.object(main, "_s3_int") as s3:
            with self.assertRaises(HTTPException) as error:
                main.mp_complete(request, {})
            self.assertEqual(error.exception.status_code, 400)
            s3.complete_multipart_upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
