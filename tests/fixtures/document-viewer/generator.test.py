"""Acceptance tests for the bounded, structurally valid large-profile generator."""

from __future__ import annotations

import hashlib
import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts" / "generate-viewer-large-profiles.py"
SPEC = importlib.util.spec_from_file_location("viewer_large_profiles", SCRIPT)
assert SPEC and SPEC.loader
GENERATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GENERATOR)


class LargeProfileGeneratorTests(unittest.TestCase):
    def test_generates_expected_structures_counts_and_deterministic_hashes(self) -> None:
        output = REPO / "tmp" / f"viewer-fixtures-test-{self.id().rsplit('.', 1)[-1]}"
        if output.exists():
            shutil.rmtree(output)
        try:
            subprocess.run(
                [sys.executable, str(SCRIPT), "--output", str(output), "--verify"],
                check=True,
                capture_output=True,
                text=True,
            )
            pdf = output / "large-1000-pages.pdf"
            docx = output / "large-500-pages.docx"
            pptx = output / "large-200-slides.pptx"
            self.assertTrue(pdf.is_file())
            self.assertTrue(docx.is_file())
            self.assertTrue(pptx.is_file())
            self.assertLess(pdf.stat().st_size, 64 * 1024 * 1024)
            self.assertLess(docx.stat().st_size, 48 * 1024 * 1024)
            self.assertLess(pptx.stat().st_size, 64 * 1024 * 1024)

            pdf_bytes = pdf.read_bytes()
            self.assertEqual(pdf_bytes.count(b"/Type /Page "), 1000)
            self.assertIn(b"KOBY-LARGE-PDF-1000-PAGES", pdf_bytes)

            with zipfile.ZipFile(docx) as archive:
                names = set(archive.namelist())
                self.assertIn("[Content_Types].xml", names)
                self.assertIn("word/document.xml", names)
                document = archive.read("word/document.xml")
                self.assertEqual(document.count(b"w:br w:type=\"page\""), 499)
                self.assertIn(b"KOBY-LARGE-DOCX-500-PAGES", document)

            with zipfile.ZipFile(pptx) as archive:
                names = set(archive.namelist())
                self.assertIn("[Content_Types].xml", names)
                self.assertIn("ppt/presentation.xml", names)
                slide_names = {name for name in names if name.startswith("ppt/slides/slide") and name.endswith(".xml")}
                self.assertEqual(len(slide_names), 200)
                self.assertIn(b"KOBY-LARGE-PPTX-200-SLIDES", archive.read("ppt/slides/slide1.xml"))

            hashes = [hashlib.sha256(path.read_bytes()).hexdigest() for path in (pdf, docx, pptx)]
            subprocess.run(
                [sys.executable, str(SCRIPT), "--output", str(output), "--verify"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(hashes, [hashlib.sha256(path.read_bytes()).hexdigest() for path in (pdf, docx, pptx)])
        finally:
            if output.exists():
                shutil.rmtree(output)

    def test_rejects_output_path_outside_repo_tmp_and_symlink(self) -> None:
        outside = Path(tempfile.mkdtemp(prefix="viewer-generator-outside-"))
        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--output", str(REPO / "tmp")],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--output", str(outside / "out")],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("tmp", result.stderr)

            fake_repo = Path(tempfile.mkdtemp(prefix="viewer-generator-repo-"))
            fake_tmp_target = Path(tempfile.mkdtemp(prefix="viewer-generator-tmp-"))
            try:
                (fake_repo / "tmp").symlink_to(fake_tmp_target, target_is_directory=True)
                with self.assertRaisesRegex(ValueError, "symlink"):
                    GENERATOR._validate_output_path(str(fake_repo / "tmp" / "profile"), repo_root=fake_repo)
            finally:
                (fake_repo / "tmp").unlink(missing_ok=True)
                shutil.rmtree(fake_repo)
                shutil.rmtree(fake_tmp_target)
        finally:
            shutil.rmtree(outside)


if __name__ == "__main__":
    unittest.main()
