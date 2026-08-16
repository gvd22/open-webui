#!/usr/bin/env python3
"""Create deterministic, valid document-viewer profiling inputs.

The generated files are intentionally local-only.  The output directory must
be a new or existing descendant of this checkout's ``tmp/`` directory; this
prevents an accidental invocation from overwriting source files or following
a symlink out of the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import sys
from xml.sax.saxutils import escape
import zipfile


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
PDF_SENTINEL = "KOBY-LARGE-PDF-1000-PAGES"
DOCX_SENTINEL = "KOBY-LARGE-DOCX-500-PAGES"
PPTX_SENTINEL = "KOBY-LARGE-PPTX-200-SLIDES"


def _zip_write(path: Path, entries: dict[str, bytes]) -> None:
    """Write a reproducible ZIP package with fixed metadata and ordering."""

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 0
            info.external_attr = 0
            archive.writestr(info, entries[name])


def make_pdf(page_count: int, sentinel: str = PDF_SENTINEL) -> bytes:
    """Build a small but fully cross-referenced PDF with ``page_count`` pages."""

    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    page_ids = list(range(3, page_count + 3))
    objects.append(
        f"<< /Type /Pages /Kids [{' '.join(f'{page_id} 0 R' for page_id in page_ids)}] /Count {page_count} >>".encode()
    )
    content_ids = list(range(page_count + 3, 2 * page_count + 3))
    font_id = 2 * page_count + 3
    for index, content_id in enumerate(content_ids, start=1):
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>".encode()
        )
    for index in range(1, page_count + 1):
        text = sentinel if index == 1 else f"KOBY profiling page {index}"
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET\n".encode("ascii")
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"endstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for object_id, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{object_id} 0 obj\n".encode())
        output.extend(body)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode()
    )
    return bytes(output)


def _docx_entries(page_count: int, sentinel: str) -> dict[str, bytes]:
    body: list[str] = [
        '<w:p><w:r><w:t xml:space="preserve">',
        escape(sentinel),
        "</w:t></w:r></w:p>",
        '<w:p><w:r><w:t>Unicode: Zürich — café 漢字</w:t></w:r></w:p>',
        '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>',
        '<w:tr><w:tc><w:p><w:r><w:t>Column A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Column B</w:t></w:r></w:p></w:tc></w:tr>',
        '<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr>',
        "</w:tbl>",
        '<w:p><w:hyperlink r:id="rIdHyperlink"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t>Safe link</w:t></w:r></w:hyperlink></w:p>',
    ]
    for page in range(1, page_count):
        body.append(f'<w:p><w:r><w:t>Page {page + 1}</w:t><w:br w:type="page"/></w:r></w:p>')
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<w:body>' + "".join(body) + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>'
    ).encode()
    return {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>'
        ).encode(),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>'
        ).encode(),
        "word/document.xml": document,
        "word/_rels/document.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rIdHyperlink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/koby" TargetMode="External"/>'
            '</Relationships>'
        ).encode(),
    }


def make_docx(path: Path, page_count: int = 500, sentinel: str = DOCX_SENTINEL) -> None:
    _zip_write(path, _docx_entries(page_count, sentinel))


def _pptx_slide(slide_number: int, sentinel: str, rich: bool = False) -> bytes:
    text = sentinel if slide_number == 1 else f"KOBY profiling slide {slide_number}"
    rich_content = (
        '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="2194560"/><a:ext cx="4572000" cy="1828800"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="1000"/><a:gridCol w="1000"/></a:tblGrid><a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Cell A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Cell B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr><a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>1</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>2</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
        '<p:sp><p:nvSpPr><p:cNvPr id="5" name="Unicode"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="4572000"/><a:ext cx="6400800" cy="457200"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Unicode: Zürich — café 漢字</a:t></a:r></a:p></p:txBody></p:sp>'
        '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Safe link"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="8686800" y="5486400"/><a:ext cx="1828800" cy="457200"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:hlinkClick r:id="rIdHyperlink"/><a:r><a:t>Safe link</a:t></a:r></a:p></p:txBody></p:sp>'
        if rich
        else ""
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="548640"/><a:ext cx="10058400" cy="1097280"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>'
        + escape(text)
        + '</a:t></a:r></a:p></p:txBody></p:sp>'
        + rich_content
        + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
    ).encode()


def _pptx_entries(slide_count: int, sentinel: str) -> dict[str, bytes]:
    entries: dict[str, bytes] = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
            + "".join(f'<Override PartName="/ppt/slides/slide{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for n in range(1, slide_count + 1))
            + "</Types>"
        ).encode(),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
            '</Relationships>'
        ).encode(),
    }
    slide_ids = "".join(f'<p:sldId id="{255 + n}" r:id="rId{n}"/>' for n in range(1, slide_count + 1))
    entries["ppt/presentation.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        f'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:slideIdLst>{slide_ids}</p:slideIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
    ).encode()
    entries["ppt/_rels/presentation.xml.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
        + "".join(f'<Relationship Id="rId{n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{n}.xml"/>' for n in range(1, slide_count + 1))
        + "</Relationships>"
    ).encode()
    entries["ppt/slideMasters/slideMaster1.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>'
    ).encode()
    entries["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
    ).encode()
    entries["ppt/slideLayouts/slideLayout1.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
    ).encode()
    entries["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'
    ).encode()
    for n in range(1, slide_count + 1):
        entries[f"ppt/slides/slide{n}.xml"] = _pptx_slide(n, sentinel, rich=slide_count <= 3 and n == 1)
        entries[f"ppt/slides/_rels/slide{n}.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ('<Relationship Id="rIdHyperlink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/koby" TargetMode="External"/>' if slide_count <= 3 and n == 1 else '')
            + '</Relationships>'
        ).encode()
    return entries


def make_pptx(path: Path, slide_count: int = 200, sentinel: str = PPTX_SENTINEL) -> None:
    _zip_write(path, _pptx_entries(slide_count, sentinel))


def _validate_output_path(raw_output: str, repo_root: Path = REPO_ROOT) -> Path:
    # abspath normalizes lexical ``..`` without following symlinks.
    repo_root = Path(os.path.abspath(repo_root))
    tmp_root = repo_root / "tmp"
    if tmp_root.is_symlink():
        raise ValueError(f"repo tmp/ must not be a symlink: {tmp_root}")
    if not tmp_root.is_dir():
        raise ValueError(f"repo tmp/ must be an existing directory: {tmp_root}")
    output = Path(os.path.abspath(os.path.expanduser(raw_output)))
    try:
        output.relative_to(tmp_root)
    except ValueError as exc:
        raise ValueError(f"output must be a descendant of repo tmp/: {output}") from exc
    if output == tmp_root:
        raise ValueError("output must be a child directory below repo tmp/")
    current = repo_root
    for component in output.relative_to(repo_root).parts:
        current /= component
        if current.is_symlink():
            raise ValueError(f"output path contains a symlink: {current}")
    resolved_tmp = tmp_root.resolve()
    resolved_output = output.resolve()
    try:
        resolved_output.relative_to(resolved_tmp)
    except ValueError as exc:
        raise ValueError(f"resolved output escapes repo tmp/: {resolved_output}") from exc
    if output.exists() and not output.is_dir():
        raise ValueError(f"output must be a directory: {output}")
    return output


def _verify_pdf(path: Path, expected_pages: int) -> None:
    data = path.read_bytes()
    if data.count(b"/Type /Page ") != expected_pages or PDF_SENTINEL.encode() not in data:
        raise ValueError(f"invalid PDF profile: {path}")


def _verify_zip_profile(path: Path, expected_name: str, expected_count: int, sentinel: bytes) -> None:
    with zipfile.ZipFile(path) as archive:
        if "[Content_Types].xml" not in archive.namelist():
            raise ValueError(f"missing content types in {path}")
        if expected_name == "docx":
            data = archive.read("word/document.xml")
            if data.count(b"w:br w:type=\"page\"") != expected_count - 1:
                raise ValueError(f"invalid DOCX page count: {path}")
        else:
            slide_count = sum(bool(re.match(r"^ppt/slides/slide\d+\.xml$", name)) for name in archive.namelist())
            if slide_count != expected_count:
                raise ValueError(f"invalid PPTX slide count: {path}")
            data = archive.read("ppt/slides/slide1.xml")
        if sentinel not in data:
            raise ValueError(f"missing sentinel in {path}")


def generate(output: Path) -> tuple[Path, Path, Path]:
    output.mkdir(parents=True, exist_ok=True)
    pdf = output / "large-1000-pages.pdf"
    docx = output / "large-500-pages.docx"
    pptx = output / "large-200-slides.pptx"
    for path in (pdf, docx, pptx):
        if path.is_symlink():
            raise ValueError(f"output file is a symlink: {path}")
    pdf.write_bytes(make_pdf(1000))
    make_docx(docx)
    make_pptx(pptx)
    return pdf, docx, pptx


def verify(paths: tuple[Path, Path, Path]) -> None:
    pdf, docx, pptx = paths
    _verify_pdf(pdf, 1000)
    _verify_zip_profile(docx, "docx", 500, DOCX_SENTINEL.encode())
    _verify_zip_profile(pptx, "pptx", 200, PPTX_SENTINEL.encode())
    limits = {pdf: 64 * 1024 * 1024, docx: 48 * 1024 * 1024, pptx: 64 * 1024 * 1024}
    for path, limit in limits.items():
        if path.stat().st_size >= limit:
            raise ValueError(f"profile exceeds viewer limit: {path}")


def _write_small_fixtures(root: Path) -> None:
    (root / "pdf").mkdir(parents=True, exist_ok=True)
    (root / "docx").mkdir(parents=True, exist_ok=True)
    (root / "pptx").mkdir(parents=True, exist_ok=True)
    (root / "pdf" / "basic.pdf").write_bytes(make_pdf(2, "KOBY-BASIC-PDF-2-PAGES"))
    make_docx(root / "docx" / "basic.docx", 2, "KOBY-BASIC-DOCX-2-PAGES")
    make_pptx(root / "pptx" / "basic.pptx", 2, "KOBY-BASIC-PPTX-2-SLIDES")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="output directory below this checkout's tmp/")
    parser.add_argument("--verify", action="store_true", help="verify counts, ZIP structure, sentinels, and size limits")
    args = parser.parse_args(argv)
    try:
        output = _validate_output_path(args.output)
        paths = generate(output)
        if args.verify:
            verify(paths)
        for path in paths:
            print(f"{path} {path.stat().st_size} bytes sha256={hashlib.sha256(path.read_bytes()).hexdigest()}")
        return 0
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"generate-viewer-large-profiles: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
