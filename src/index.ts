#!/usr/bin/env node
// fixproto3.ts
// Usage: ts-node fixproto3.ts file1.proto [file2.proto ...]
// Renumber protobuf3 message field tags sequentially per message (including oneof members).

import * as fs from "fs";
import * as os from "os"
import * as path from "path";

if (require.main === module && process.argv.length < 3) {
    console.error("Usage: node fixproto3.js file1.proto [file2.proto ...]");
    process.exit(1);
}

function findMatchingBrace(text: string, openPos: number): number {
    let i = openPos;
    const len = text.length;
    let depth = 0;
    let inSingleLineComment = false;
    let inMultiLineComment = false;
    let inDoubleQuote = false;
    let inSingleQuote = false;
    while (i < len) {
        const ch = text[i];
        const next = i + 1 < len ? text[i + 1] : "";
        // handle comment starts/ends
        if (!inSingleLineComment && !inMultiLineComment && !inDoubleQuote && !inSingleQuote) {
            if (ch === "/" && next === "/") {
                inSingleLineComment = true;
                i += 2;
                continue;
            } else if (ch === "/" && next === "*") {
                inMultiLineComment = true;
                i += 2;
                continue;
            } else if (ch === '"') {
                inDoubleQuote = true;
                i++;
                continue;
            } else if (ch === "'") {
                inSingleQuote = true;
                i++;
                continue;
            }
        } else if (inSingleLineComment) {
            if (ch === "\n") inSingleLineComment = false;
            i++;
            continue;
        } else if (inMultiLineComment) {
            if (ch === "*" && next === "/") {
                inMultiLineComment = false;
                i += 2;
                continue;
            }
            i++;
            continue;
        } else if (inDoubleQuote) {
            if (ch === "\\" && next) { i += 2; continue; }
            if (ch === '"') inDoubleQuote = false;
            i++;
            continue;
        } else if (inSingleQuote) {
            if (ch === "\\" && next) { i += 2; continue; }
            if (ch === "'") inSingleQuote = false;
            i++;
            continue;
        }

        if (ch === "{") {
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return -1;
}

function renumberMessageBody(body: string): string {
    // field pattern:
    // [label] type name = number [options] ;
    // map<...> name = number ;
    // We'll match occurrences of "= number" with preceding "type name =" so we can replace the number.
    let counter = 1;
    const fieldRegex = /(^\s*(?:optional|required|repeated)?\s*(?:map<[^>]+>|[A-Za-z0-9_.<>]+)\s+[A-Za-z_]\w*\s*=\s*)(\d+)(\s*(?:\[[^\]]*\])?\s*;)/gm;
    return body.replace(fieldRegex, (_m, p1, _num, p3) => {
        const newNum = String(counter++);
        return p1 + newNum + p3;
    });
}

function processProtoText(text: string): { result: string; changed: boolean } {
    // Find all "message Name {" occurrences and matching braces.
    const msgRegex = /\bmessage\s+([A-Za-z_]\w*)\s*\{/g;
    const ranges: { open: number; close: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = msgRegex.exec(text)) !== null) {
        const matchStart = match.index;
        const matchStr = match[0];
        const braceIndexWithinMatch = matchStr.lastIndexOf("{");
        const openPos = matchStart + braceIndexWithinMatch;
        const closePos = findMatchingBrace(text, openPos);
        if (closePos === -1) {
            // unmatched — skip
            continue;
        }
        ranges.push({ open: openPos, close: closePos });
        // continue searching after this match to find nested ones too
        msgRegex.lastIndex = match.index + 1;
    }

    // Sort ranges by open descending so inner/nested messages processed first
    ranges.sort((a, b) => b.open - a.open);

    let result = text;
    let anyChange = false;
    for (const r of ranges) {
        const bodyStart = r.open + 1;
        const bodyEnd = r.close;
        const body = result.slice(bodyStart, bodyEnd);
        const newBody = renumberMessageBody(body);
        if (newBody !== body) {
            result = result.slice(0, bodyStart) + newBody + result.slice(bodyEnd);
            anyChange = true;
        }
    }
    return { result, changed: anyChange };
}

for (const arg of process.argv.slice(2)) {
    const filePath = path.resolve(process.cwd(), arg);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        continue;
    }
    const original = fs.readFileSync(filePath, "utf8");
    const { result, changed } = processProtoText(original);
    if (!changed) {
        console.log(`No changes: ${filePath}`);
        continue;
    }
    // backup
    let tempDir1 = `${os.tmpdir()}/`
    // if (!fs.existsSync(tempDir1)) {
    //     fs.mkdirSync(tempDir1, { recursive: true })
    // }
    let tempDir = fs.mkdtempSync(tempDir1, { encoding: "utf-8" })
    let fileName = path.basename(filePath)
    const bak = path.join(tempDir, `${fileName}.bak`);
    fs.writeFileSync(bak, original, "utf8");
    fs.writeFileSync(filePath, result, "utf8");
    console.log(`Renumbered and saved: ${filePath} (backup: ${bak})`);
}
