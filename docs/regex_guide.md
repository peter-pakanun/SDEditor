# Regex Guide

This guide explains how to use **Regex** (pattern matching) for advanced translation replacements in the SDEditor.

## What is Regex?

Regex is a way to define flexible **patterns** that match text with variations. Instead of translating each variation separately, you write one pattern that covers many cases.

For example:
- Dictionary: `"{0}% increased [Fire] Damage"` → `"้เพิ่มความเสียหาย [Fire|ไฟ] {0}%"`
- Regex: `"([^ ]+) (increased|reduced) (.+) Damage"` → `"$2ความเสียหาย $2 $3"`

## Basic Pattern Syntax

### Capturing Groups: `(...)`

Parentheses `(...)` capture a part of the text so you can use it in the replacement.

**Example:**
```
Find:    (.+) Resistance
Replace: ความเสียหาย $1

Matches → Replacement:
  "[Resistances|Fire] Resistance"      → "ความเสียหาย [Fire|ไฟ]"
  "[Resistances|Cold] Resistance"      → "ความเสียหาย [Cold|น้ำแข็ง]"
```

The `(.+)` part means "capture any character(s) one or more times".

### Referencing Captured Groups: `$1`, `$2`, etc.

In the replacement, use `$1`, `$2`, `$3` etc. to refer to the captured groups:
- `$1` = first captured group
- `$2` = second captured group
- And so on...

**Example with Multiple Groups:**
```
Find:    \+(\d+) to (.+) per (.+)
Replace: $2 +$1 ต่อ $3

Matches:
  "+1 to [Armour] per [Strength]"  → "[Armour|ค่าเกราะ] +1 ต่อ [Strength|Strength]"
```

Here:
- `(\d+)` captures "1" → `$1`
- `(.+)` captures "[Armour]" → `$2`
- `(.+)` captures "[Strength]" → `$3`

## Common Pattern Patterns

| Pattern  | Meaning                 | Example                                   |
|----------|-------------------------|-------------------------------------------|
| `.`      | Any single character    | `.` = any character                       |
| `+`      | One or more             | `(.+)` = one or more of anything          |
| `*`      | Zero or more            | `a*` = zero or more "a"s                  | 
| `\d`     | Any digit (0-9)         | `(\d+)` = one or more digits              |
| `[^ ]`   | Any non-space character | `([^ ]+)` = one or more non-space chars   |
| `\b`     | Word boundary           | `\b(.+)\b` = word boundaries              |
| `(a\|b)` | "a" or "b"              | `(increased\|reduced)` = one or the other |

Learn more about Regex and test your patterns at [regexr.com](https://regexr.com/)

## Special Handling in SDEditor Regex

## Keyword Popups `[TagName|Text]` are Handled

Keyword popups like `[HitDamage|Hits]` are automatically converted to capture groups:
- `[HitDamage|Hits]` becomes a wildcard that matches the dynamic text inside the brackets ("HitDamage" or "Hits")

## Recursive Lookups: `$R1`, `$R2`, etc.

Use `$R1`, `$R2` (with a capital `R`) to recursively apply the Regex pattern to the captured groups again.

This means: "Look up the captured text as a Regex too."

## Real-World Examples

WIP

## Debugging Your Regex

WIP

## When to Use Regex vs. Dictionary

| Use **Dictionary** if... | Use **Regex** if... |
|---|---|
| You're translating a simple word or phrase | The text has variations or multiple parts to reorder |
| The translation is always the same | Different variables need different positions |
| You want quick lookups | The pattern applies to many similar texts |
| The term appears in many contexts | The term appears in a specific pattern |

## Resources

For more information on regex syntax, see standard regex documentation. The patterns used here follow standard ECMAScript (JavaScript) regex syntax with the `igm` flags (case-insensitive, global, multiline).

