# gauntlet-loop (vendored skill)

Installed from https://github.com/robonuggets/gauntlet-loop

- Upstream commit: `9b1975a1b8f01981f3f1e6b667ad3aaf907178ea` (2026-08-06)
- `SKILL.md` is byte-identical to upstream. Do not edit it in place; re-vendor
  from upstream instead so the diff against the source stays readable.
- Licence: CC BY 4.0 (see `LICENSE`).
- Skill by Jay E at RoboNuggets. The gauntlet loop technique is Matt Shumer's,
  from https://github.com/mshumer/Claude-of-Duty

## Updating

```
git clone --depth 1 https://github.com/robonuggets/gauntlet-loop /tmp/gauntlet-loop
cp /tmp/gauntlet-loop/.claude/skills/gauntlet-loop/SKILL.md .claude/skills/gauntlet-loop/SKILL.md
cp /tmp/gauntlet-loop/LICENSE .claude/skills/gauntlet-loop/LICENSE
```

## Use

```
/gauntlet-loop <your goal>
```

It proposes 2-3 concrete quality bars, you pick one, and it hands back a single
paste-ready prompt that runs builder/critic pairs until the critic picks your
work over the bar in a blind comparison.
