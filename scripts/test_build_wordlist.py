import contextlib
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from build_wordlist import REQUIRED, TAGS, build, record


def row(word="apple", **changes):
    item = {field: "" for field in REQUIRED}
    item.update(word=word, tag="cet4 gk", translation="n. 苹果", frq="12")
    item.update(changes)
    return item


class BuildTests(unittest.TestCase):
    def test_fields_newlines_full_definition_and_stable_id(self):
        entry = record(row("Apple", translation="n. 第一条\\nv. 第二条\\n第三条\\n第四条", definition="first\\nsecond", frq="", collins="5", oxford="1"))
        self.assertEqual(entry["translation"], "n. 第一条\nv. 第二条\n第三条")
        self.assertTrue(entry["translationFull"].endswith("第四条"))
        self.assertEqual(entry["definition"], "first\nsecond")
        self.assertEqual(entry["frq"], 0)
        self.assertEqual(entry["id"], record(row("apple"))["id"])
        self.assertEqual(set(entry), {"id", "word", "phonetic", "translation", "translationFull", "definition", "pos", "collins", "oxford", "frq", "exchange"})

    def test_streaming_tags_custom_missing_dedup_and_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "ecdict.csv"
            custom = root / "custom"
            custom.mkdir()
            (custom / "my-words.txt").write_text("\ufeffAPPLE\nriver\nmissing\nriver\n", encoding="utf-8")
            with source.open("w", newline="", encoding="utf-8-sig") as handle:
                writer = csv.DictWriter(handle, fieldnames=sorted(REQUIRED))
                writer.writeheader()
                writer.writerows([row(), row("APPLE"), row("river", tag="", translation='n. 河流\n含有,逗号和"引号"'), row("zero", frq="0"), row("near-tag", tag="cet40"), row("first", frq="1")])
            errors = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(errors):
                counts = build(source, root / "out", custom)
            self.assertEqual(set(counts), set(TAGS) | {"my-words"})
            self.assertEqual(counts["cet4"], 3)
            self.assertIn("[未找到] my-words: missing", errors.getvalue())
            cet4 = json.loads((root / "out/cet4.json").read_text(encoding="utf-8"))
            self.assertEqual([word["word"] for word in cet4], ["first", "apple", "zero"])
            mine = json.loads((root / "out/my-words.json").read_text(encoding="utf-8"))
            self.assertEqual({word["word"] for word in mine}, {"apple", "river"})
            self.assertEqual(mine[0]["id"], cet4[1]["id"])
            self.assertEqual(len(mine[1]["translation"].splitlines()), 2)
            index = json.loads((root / "out/index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["counts"]["cet4"], 3)
            self.assertEqual(index["memberships"]["ecdict:apple"], 6)
            self.assertNotIn("ecdict:river", index["memberships"])

    def test_bad_header_and_name_collisions_do_not_write_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "bad.csv"
            source.write_text("word,tag\napple,cet4\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "缺少字段"):
                build(source, root / "out", root / "custom")
            self.assertFalse((root / "out").exists())
            (root / "custom").mkdir()
            (root / "custom/cet4.txt").write_text("apple", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "不能使用考试标签名"):
                build(source, root / "out", root / "custom")


if __name__ == "__main__":
    unittest.main()
