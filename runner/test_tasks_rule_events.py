import pathlib
import tempfile
import unittest

from tasks import _consume_rule_events_from_log


class RuleEventParserTests(unittest.TestCase):
    def _tracker(self):
        return {"context_rule": "", "job_rules": {}, "active_rules": set()}

    def test_parallel_rules_finish_by_snakemake_job_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = pathlib.Path(tmp) / "snakemake.log"
            log_path.write_text(
                "localrule eggnog_mapper:\n"
                "    jobid: 15\n"
                "localrule antismash:\n"
                "    jobid: 20\n"
                "Finished job 20.\n",
                encoding="utf-8",
            )

            events, cursor, tracker = _consume_rule_events_from_log(
                log_path, 0, self._tracker()
            )

            lifecycle = [(action, rule) for action, rule, _, _ in events]
            self.assertEqual(
                lifecycle,
                [
                    ("start", "eggnog_mapper"),
                    ("start", "antismash"),
                    ("done", "antismash"),
                ],
            )
            self.assertEqual(tracker["active_rules"], {"eggnog_mapper"})

            with log_path.open("a", encoding="utf-8") as handle:
                handle.write("Finished job 15.\n")
            events, _, tracker = _consume_rule_events_from_log(
                log_path, cursor, tracker
            )
            self.assertIn(("done", "eggnog_mapper", "", ""), events)
            self.assertEqual(tracker["active_rules"], set())

    def test_rule_remains_active_until_all_parallel_instances_finish(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = pathlib.Path(tmp) / "snakemake.log"
            log_path.write_text(
                "rule prokka_per_mag:\n"
                "    jobid: 31\n"
                "rule prokka_per_mag:\n"
                "    jobid: 32\n"
                "Finished job 31.\n",
                encoding="utf-8",
            )

            events, cursor, tracker = _consume_rule_events_from_log(
                log_path, 0, self._tracker()
            )
            lifecycle = [(action, rule) for action, rule, _, _ in events]
            self.assertEqual(lifecycle, [("start", "prokka_per_mag")])
            self.assertEqual(tracker["active_rules"], {"prokka_per_mag"})

            with log_path.open("a", encoding="utf-8") as handle:
                handle.write("Finished job 32.\n")
            events, _, tracker = _consume_rule_events_from_log(
                log_path, cursor, tracker
            )
            self.assertIn(("done", "prokka_per_mag", "", ""), events)
            self.assertEqual(tracker["active_rules"], set())


if __name__ == "__main__":
    unittest.main()
