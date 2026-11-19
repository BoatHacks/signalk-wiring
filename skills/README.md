# Agent skills

Skills for AI coding agents that work with signalk-wiring. A skill is a folder with a
`SKILL.md` (instructions, in the Agent Skills format) plus reference files and tools.

## document-boat-wiring

Documents a whole boat's electrical system in signalk-wiring, working with the owner.

1. It gathers what the owner has: owner's manual wiring sheets, refit plans and parts
   lists, photos of panels and bus bars.
2. It builds the model on a local sandbox server.
3. It interviews the owner one question at a time to fill the gaps.
4. It installs the result on the boat's SignalK server.

Needs Node.js 22.13 or newer and an agent that can read images.

### Installing it

Claude Code: copy or link the folder into your skills folder.

```sh
git clone https://github.com/BoatHacks/signalk-wiring.git
mkdir -p ~/.claude/skills
cp -R signalk-wiring/skills/document-boat-wiring ~/.claude/skills/
```

Then start Claude Code in an empty folder for your boat and ask it to document your
boat's wiring.

Other agents that read Agent Skills load the folder the same way, from their own skills
folder. For any other agent, point it at `skills/document-boat-wiring/SKILL.md` and ask
it to follow it.

Your drawings, photos and notes stay on your computer, in the folder you work in. The
skill writes to your boat's SignalK server only through the plugin's API, only after you
approve, and never asks for your password.
