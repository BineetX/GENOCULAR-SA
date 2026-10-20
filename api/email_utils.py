import os
import smtplib
from email.message import EmailMessage
from html import escape
from typing import Optional
from urllib.parse import quote

# ---------------------------------------------------------------------------
# SMTP / frontend config
# ---------------------------------------------------------------------------
SMTP_HOST    = os.getenv("SMTP_HOST", "localhost")
SMTP_PORT    = int(os.getenv("SMTP_PORT", "25"))
SMTP_USER    = os.getenv("SMTP_USER")
SMTP_PASS    = os.getenv("SMTP_PASS")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "false").lower() == "true"

# If SMTP_FROM is not set, fall back to SMTP_USER (or a generic string)
SMTP_FROM    = os.getenv("SMTP_FROM") or (SMTP_USER or "CBB LAB <noreply@example.com>")

# UI base URL for deep links in emails
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:8080")


def _job_url(job_id: str) -> str:
    return f"{FRONTEND_URL.rstrip('/')}/jobs?job_id={quote(str(job_id or ''), safe='')}"


# ---------------------------------------------------------------------------
# Low-level sender with debug logging
# ---------------------------------------------------------------------------
def _send_email(msg: EmailMessage) -> None:
    """
    Actually send the email using the global SMTP_* settings.
    Prints debug info so we can see in `docker compose logs -f api`
    exactly what is happening.
    """
    print(
        f"[email] Sending mail via {SMTP_HOST}:{SMTP_PORT} "
        f"user={SMTP_USER!r} to={msg.get('To')!r} tls={SMTP_USE_TLS}"
    )
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            if SMTP_USE_TLS:
                s.starttls()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        print("[email] Mail sent OK.")
    except Exception as e:
        print(f"[email] ERROR sending mail: {e}")
        raise


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------
def _build_html_wrapper(title: str, body_html: str) -> str:
    """Clean, conservative HTML email for broad mail-client support."""
    return f"""
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
            <tr>
              <td style="padding:22px 26px 10px 26px;">
                <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;font-weight:700;">GENOCULAR</div>
                <h1 style="font-size:20px;line-height:1.3;margin:8px 0 10px 0;color:#111827;">{escape(title)}</h1>
                <div style="color:#374151;font-size:14px;line-height:1.6;">
                  {body_html}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 26px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
                This is an automated notification from GENOCULAR. Please do not reply to this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    """.strip()


def _add_button(url: str, label: str = "Open in GENOCULAR") -> str:
    safe_url = escape(url, quote=True)
    safe_label = escape(label)
    return f"""
      <p style="margin:22px 0 6px 0;">
        <a href="{safe_url}" style="
          display:inline-block;
          padding:11px 18px;
          background:#111827;
          color:#ffffff;
          border-radius:6px;
          font-size:14px;
          font-weight:600;
          text-decoration:none;
        ">
          {safe_label}
        </a>
      </p>
    """


def _format_bytes(size) -> str:
    try:
        value = float(size or 0)
    except Exception:
        return ""
    if value <= 0:
        return ""
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    decimals = 2 if value < 10 and idx > 0 else 1 if idx > 0 else 0
    return f"{value:.{decimals}f} {units[idx]}"


def _title_case(value: str) -> str:
    return str(value or "").replace("_", " ").replace("-", " ").title()


def _status_value(job) -> str:
    status = getattr(job, "status", None)
    return str(getattr(status, "value", status) or "").replace("_", " ").title()


def _manifest(job) -> dict:
    manifest = getattr(job, "input_manifest", None)
    return manifest if isinstance(manifest, dict) else {}


def _job_type_label(manifest: dict) -> str:
    analysis = _title_case(manifest.get("analysis_type"))
    mode = _title_case(manifest.get("read_mode"))
    return " / ".join(part for part in (analysis, mode) if part)


def _job_details_html(job) -> str:
    rows = []

    def add_row(label: str, value: Optional[str]):
        if value:
            rows.append(f"""
              <tr>
                <td style="padding:8px 10px;color:#6b7280;font-size:13px;width:150px;border-bottom:1px solid #e5e7eb;">{escape(str(label))}</td>
                <td style="padding:8px 10px;color:#111827;font-size:13px;border-bottom:1px solid #e5e7eb;">{escape(str(value))}</td>
              </tr>
            """)

    job_id = getattr(job, "job_id", getattr(job, "id", None))
    manifest = _manifest(job)
    submitter_name = manifest.get("submitter_name") or ""
    submitter_email = manifest.get("submitter_email") or getattr(job, "user_email", None)
    add_row("Job ID", job_id)
    add_row("Job name", getattr(job, "sample", None))
    add_row("Status", _status_value(job))
    add_row("Job type", _job_type_label(manifest))
    add_row("Submitter", submitter_name or submitter_email)
    add_row("Submitter email", submitter_email)

    return f"""
      <table cellpadding="0" cellspacing="0" style="margin:14px 0;border-collapse:collapse;width:100%;border-radius:6px;border:1px solid #e5e7eb;">
        <tbody>
          {''.join(rows)}
        </tbody>
      </table>
    """


def _uploaded_files_html(job) -> str:
    files = _manifest(job).get("files")
    if not isinstance(files, list) or not files:
        return ""
    rows = []
    for item in files:
        if not isinstance(item, dict):
            continue
        role = escape(str(item.get("role") or "Input"))
        key_name = os.path.basename(str(item.get("key") or ""))
        name = escape(str(item.get("name") or key_name or "Uploaded file"))
        size = escape(_format_bytes(item.get("size")) or "Size not recorded")
        rows.append(
            "<tr>"
            f'<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;">{role}</td>'
            f'<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#111827;">{name}</td>'
            f'<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:right;">{size}</td>'
            "</tr>"
        )
    if not rows:
        return ""
    return (
        '<div style="font-size:13px;font-weight:600;color:#111827;margin-top:16px;">Uploaded files</div>'
        '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;'
        'border-radius:6px;margin-top:8px;font-size:13px;">'
        '<thead><tr>'
        '<th align="left" style="padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;">Role</th>'
        '<th align="left" style="padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;">File name</th>'
        '<th align="right" style="padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;">Size</th>'
        f"</tr></thead><tbody>{''.join(rows)}</tbody></table>"
    )


def _uploaded_files_plain(job) -> str:
    files = _manifest(job).get("files")
    if not isinstance(files, list) or not files:
        return ""
    lines = ["", "Uploaded files:"]
    for item in files:
        if not isinstance(item, dict):
            continue
        role = item.get("role") or "Input"
        key_name = os.path.basename(str(item.get("key") or ""))
        name = item.get("name") or key_name or "Uploaded file"
        size = _format_bytes(item.get("size")) or "size not recorded"
        lines.append(f"- {role}: {name} ({size})")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------
def send_job_submitted_email(job, job_url_override: Optional[str] = None) -> None:
    """Called when user submits a job."""
    user_email = getattr(job, "user_email", None)
    job_id = getattr(job, "job_id", getattr(job, "id", None))
    print(f"[email] send_job_submitted_email called for job={job_id}, user_email={user_email!r}")

    if not user_email:
        print("[email] No user_email on job; skipping submit email.")
        return

    # For account-free jobs the caller supplies a freshly issued, read-only
    # capability link. It is sent once and is never stored in the database.
    job_url = str(job_url_override or "").strip() or _job_url(job_id)
    manifest = _manifest(job)
    submitter_name = manifest.get("submitter_name") or ""
    submitter_email = manifest.get("submitter_email") or user_email
    job_type = _job_type_label(manifest)
    retry_meta = manifest.get("admin_retry")
    if not isinstance(retry_meta, dict):
        retry_meta = {}
    retry_source_job_id = str(retry_meta.get("source_job_id") or "").strip()
    is_admin_retry = bool(retry_source_job_id)

    subject_action = "Job retried" if is_admin_retry else "Job submitted"
    plain_intro = (
        f"A GENOCULAR administrator retried your failed job '{job.sample}' on your behalf."
        if is_admin_retry
        else f"Your GENOCULAR job '{job.sample}' has been submitted and queued for execution."
    )
    retry_plain = f"Original job ID: {retry_source_job_id}\n" if is_admin_retry else ""
    subject = f"[GENOCULAR] {subject_action}: {job.sample}"
    plain = (
        f"Hello {submitter_name or 'there'},\n\n"
        f"{plain_intro}\n\n"
        f"Submitter: {submitter_name or submitter_email}\n"
        f"Email: {submitter_email}\n"
        f"Job name: {job.sample}\n"
        f"{retry_plain}"
        f"Job ID: {job_id}\n"
        f"Status: Queued\n"
        f"Job type: {job_type or 'Not recorded'}\n"
        f"Open in GENOCULAR: {job_url}\n"
        f"{_uploaded_files_plain(job)}\n"
    )

    html_intro = (
        "A GENOCULAR administrator has retried your failed job on your behalf."
        if is_admin_retry
        else "Your GENOCULAR job has been <strong>submitted</strong> and queued for execution."
    )
    retry_html = (
        '<p style="margin:0 0 12px 0;color:#6b7280;font-size:13px;">'
        f"Original job: <code>{escape(retry_source_job_id)}</code></p>"
        if is_admin_retry
        else ""
    )
    body_html = f"""
      <p style="margin:0 0 12px 0;">Hello {escape(submitter_name or 'there')},</p>
      <p style="margin:0 0 12px 0;">{html_intro}</p>
      {retry_html}
      {_job_details_html(job)}
      {_uploaded_files_html(job)}
      {_add_button(job_url, "View job in GENOCULAR")}
      <p style="margin-top:16px;color:#6b7280;font-size:13px;">You will receive another email when the job starts, and a final email when it finishes.</p>
    """

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = user_email
    msg.set_content(plain)
    msg.add_alternative(_build_html_wrapper(subject_action, body_html), subtype="html")

    _send_email(msg)


def send_job_completed_email(
    job,
    success: bool,
    error_snippet: Optional[str] = None
) -> None:
    """Called when job finishes (success or failure)."""
    user_email = getattr(job, "user_email", None)
    job_id = getattr(job, "job_id", getattr(job, "id", None))
    print(
        f"[email] send_job_completed_email called for job={job_id}, "
        f"success={success}, user_email={user_email!r}"
    )

    if not user_email:
        print("[email] No user_email on job; skipping completed email.")
        return

    status_text = "completed successfully" if success else "failed"
    status_label = "Completed" if success else "Failed"
    status_color = "#22c55e" if success else "#f97316"

    job_url = _job_url(job_id)
    manifest = _manifest(job)
    submitter_name = manifest.get("submitter_name") or ""
    submitter_email = manifest.get("submitter_email") or user_email
    job_type = _job_type_label(manifest)

    subject = f"[GENOCULAR] Job {status_label.lower()}: {job.sample}"
    plain = (
        f"Hello {submitter_name or 'there'},\n\n"
        f"Your GENOCULAR job '{job.sample}' has {status_text}.\n\n"
        f"Submitter: {submitter_name or submitter_email}\n"
        f"Email: {submitter_email}\n"
        f"Job name: {job.sample}\n"
        f"Job ID: {job_id}\n"
        f"Status: {status_label}\n"
        f"Job type: {job_type or 'Not recorded'}\n"
        f"Open in GENOCULAR: {job_url}\n"
        f"{_uploaded_files_plain(job)}\n"
    )
    if not success and error_snippet:
        plain += f"\nError (truncated):\n{error_snippet}\n"

    error_html = ""
    if not success and error_snippet:
        safe_snip = str(error_snippet)[:900]
        error_html = f"""
          <div style="margin-top:18px;">
            <div style="color:#991b1b;font-size:13px;font-weight:600;margin-bottom:6px;">Last error (truncated)</div>
            <pre style="background:#fef2f2;border-radius:6px;padding:10px;color:#7f1d1d;font-size:12px;white-space:pre-wrap;overflow-wrap:break-word;border:1px solid #fecaca;">{escape(safe_snip)}</pre>
          </div>
        """

    body_html = f"""
      <p style="margin:0 0 12px 0;">Hello {escape(submitter_name or 'there')},</p>
      <p style="margin:0 0 12px 0;">Your GENOCULAR job has <span style="font-weight:600;color:{status_color};">{escape(status_text)}</span>.</p>
      {_job_details_html(job)}
      {_uploaded_files_html(job)}
      {_add_button(job_url, "View job in GENOCULAR")}
      {error_html}
    """

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = user_email
    msg.set_content(plain)
    msg.add_alternative(_build_html_wrapper(f"Job {status_label}", body_html), subtype="html")

    _send_email(msg)
