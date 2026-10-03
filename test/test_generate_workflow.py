"""Check the standalone generator's output and workflow argument validation."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/generate-workflow.py"


class GenerateWorkflowTest(unittest.TestCase):
    def run_generator(self, *args: str) -> subprocess.CompletedProcess[str]:
        # The generator must work without a project, dependencies, or a build.
        with tempfile.TemporaryDirectory() as directory:
            return subprocess.run(
                [sys.executable, str(SCRIPT), *args],
                cwd=directory,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_matches_existing_workflow_example(self) -> None:
        result = self.run_generator("owner/tofarev", "a" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            (ROOT / "docs/examples/containerlab-workflow.yml").read_text(),
        )

    def test_substitutes_repository_and_commit(self) -> None:
        result = self.run_generator("hellt/tofarev", "1234567890abcdef" * 2 + "12345678")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("uses: hellt/tofarev/.github/workflows/review.yml@1234567890abcdef1234567890abcdef12345678\n", result.stdout)
        self.assertIn("bot_repository: hellt/tofarev\n", result.stdout)
        self.assertIn("bot_ref: 1234567890abcdef1234567890abcdef12345678\n", result.stdout)

    def test_rejects_invalid_or_unpinned_arguments_without_output(self) -> None:
        cases = [
            ("owner", "a" * 40),
            ("owner/repo/extra", "a" * 40),
            ("owner/repo\npermissions: write-all", "a" * 40),
            ("o" * 202 + "/repo", "a" * 40),
            ("owner/repo", "main"),
            ("owner/repo", "a" * 39),
            ("owner/repo", "A" * 40),
            ("owner/repo", "a" * 40 + "\n"),
        ]
        for args in cases:
            with self.subTest(args=args):
                result = self.run_generator(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
