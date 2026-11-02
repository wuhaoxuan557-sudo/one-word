"""Stream ECDICT into tag/custom JSON wordlists. Python standard library only."""

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAGS = ("zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre")
REQUIRED = {"word", "phonetic", "translation", "definition", "pos", "collins",
            "oxford", "frq", "exchange", "tag"}


def lines(value: str) -> str:
    # ECDICT stores literal backslash-n inside CSV cells; also accept real newlines.
    return value.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\r\n", "\n").strip()


def integer(value: str) -> int:
    try:
        return max(0, int(value or 0))
    except ValueError:
        return 0


def record(row: dict[str, str]) -> dict:
    word = row["word"].strip()
    full = lines(row["translation"])
    return {
        # Stable across tag/custom lists and CSV row order.
        "id": "ecdict:" + word.casefold(),
        "word": word,
        "phonetic": row["phonetic"].strip(),
        "translation": "\n".join(full.splitlines()[:3]),
        "translationFull": full,
        "definition": lines(row["definition"]),
        "pos": row["pos"].strip(),
        "collins": min(5, integer(row["collins"])),
        "oxford": min(1, integer(row["oxford"])),
        "frq": integer(row["frq"]),
        "exchange": row["exchange"].strip(),
    }


def build(csv_path: Path, output: Path, custom_dir: Path) -> dict[str, int]:
    custom = {
        path.stem: dict.fromkeys(
            word.strip().casefold()
            for word in path.read_text(encoding="utf-8-sig").splitlines()
            if word.strip()
        )
        for path in sorted(custom_dir.glob("*.txt"))
    }
    # Refuse ambiguous names rather than overwrite an exam wordlist.
    conflicts = {name for name in custom if name.casefold() in (*TAGS, "index")}
    if conflicts:
        raise ValueError("自定义词表不能使用考试标签名或 index：" + ", ".join(sorted(conflicts)))
    wanted = {word for words in custom.values() for word in words}
    found: dict[str, dict] = {}
    lists: dict[str, list[dict]] = {tag: [] for tag in TAGS}
    seen: set[str] = set()
    with csv_path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        missing = REQUIRED - set(reader.fieldnames or [])
        if missing:
            raise ValueError("CSV 缺少字段：" + ", ".join(sorted(missing)))
        for row in reader:
            if any(row.get(field) is None for field in REQUIRED):
                raise ValueError(f"CSV 第 {reader.line_num} 行字段不完整")
            key = row["word"].strip().casefold()
            if not key or key in seen:
                continue
            tags = set(row["tag"].split()) & set(TAGS)
            if not tags and key not in wanted:
                continue
            seen.add(key)
            item = record(row)
            for tag in tags:
                lists[tag].append(item)
            if key in wanted:
                found[key] = item
    for name, words in custom.items():
        lists[name] = [found[word] for word in words if word in found]
        for word in words:
            if word not in found:
                print(f"[未找到] {name}: {word}", file=sys.stderr)
    output.mkdir(parents=True, exist_ok=True)
    counts = {}
    for name, items in lists.items():
        items.sort(key=lambda item: (item["frq"] or float("inf"), item["word"].casefold()))
        destination = output / f"{name}.json"
        destination.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        counts[name] = len(items)
        print(f"{name}: {len(items)} 词 -> {destination}")
    write_index(lists, output)
    return counts


def write_index(lists: dict[str, list[dict]], output: Path) -> None:
    memberships: dict[str, int] = {}
    for bit, tag in enumerate(TAGS):
        for item in lists[tag]:
            memberships[item["id"]] = memberships.get(item["id"], 0) | (1 << bit)
    index = {"version": 1, "counts": {tag: len(lists[tag]) for tag in TAGS},
             "memberships": memberships}
    (output / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=ROOT / "wordlists_src/ecdict.csv")
    parser.add_argument("--out", type=Path, default=ROOT / "public/wordlists")
    parser.add_argument("--custom-dir", type=Path, default=ROOT / "wordlists_src/custom")
    args = parser.parse_args()
    try:
        build(args.csv, args.out, args.custom_dir)
    except (OSError, ValueError, csv.Error) as error:
        parser.exit(1, f"构建失败：{error}\n")


if __name__ == "__main__":
    main()
