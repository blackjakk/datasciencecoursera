"""
Extract new PixelLab animations from the downloaded character ZIPs
into the game's sprite folders.

Naming convention in the game:
    sprites/<pose>/<direction>_<frame>.png    (frame 0..3)

PixelLab v3 mode emits 5 frames per direction (frame_000 is a reference
copy of the rotation, frame_001..frame_004 is the actual cycle). We
SKIP frame_000 and map 001..004 -> 0..3.

PixelLab template animations (running-4-frames) emit 4 frames numbered
000..003 — all animated. We map them straight 0..3.

Source ZIPs:
  _carry-character.zip          (football_tucked_unde -> carry)
  _default-character.zip        (Default -> kick_slide, backpedal,
                                            dive_forward)

Folder-prefix to pose map (inside the ZIP's animations directory):
  football_tucked_unde/.../football_player_sprinting_forward_with_the_footbal-...  -> carry (v3)
  football_tucked_unde/.../running-...                                              -> carry (template)
  Default/.../offensive_lineman_in_pass-pro_kick-slide_stance_kn-...               -> kick_slide (v3)
  Default/.../defensive_back_backpedaling_facing_forward_toward-...                -> backpedal (v3)
  Default/.../football_player_launching_horizontally_forward_in-...               -> dive_forward (v3)
"""
import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent

# (prefix, pose, is_v3)
SOURCES = [
    # Carry — football-tucked-under, both halves merge into one pose
    ("football_player_sprinting_forward_with_the_footbal", "carry",        True),
    # "running-" with trailing dash — matches "running-<hash>" (the
    # template animation folder) but NOT "running_back_*" which would
    # otherwise grab juke/spin/hurdle/etc. as carry.
    ("running-",                                           "carry",        False),
    # RB highlight pack — all on football-tucked-under (ball-in-hand)
    ("running_back_executing_a_juke_move_with_the_footba", "juke",         True),
    # Spin has several attempts — all valid prefixes routed to the same
    # pose. The most recent overwrites for any given direction; the
    # extractor uses whichever matches.
    ("running_back_executing_a_FULL_360-degree_spin_move", "spin",         True),
    ("running_back_executing_a_spin_move_with_the_footba", "spin",         True),
    ("running_back_doing_a_quick_whirling_360-degree_spi", "spin",         True),
    ("running_back_hurdling_over_a_defender_with_the_foo", "hurdle",       True),
    ("power_running_back_trucking_through_a_would-be_tac", "truck",        True),
    # Stiff-arm — multiple prompt variants
    ("running_back_stiff-arming_a_defender",               "stiff_arm",    True),
    ("running_back_delivering_a_stiff-arm_to_a_defender",  "stiff_arm",    True),
    ("running_back_sprinting_forward_with_one_arm_fully",  "stiff_arm",    True),
    # Default character poses
    ("offensive_lineman_in_pass-pro_kick-slide_stance",    "kick_slide",   True),
    ("defensive_back_backpedaling_facing_forward_toward",  "backpedal",    True),
    ("defensive_back_in_a_low_crouched_athletic_stance",   "backpedal",    True),
    ("football_player_launching_horizontally_forward_in",  "dive_forward", True),
]

ZIPS = [ROOT / "_carry-character.zip", ROOT / "_default-character.zip"]
DIRS = ("south", "north", "east", "west",
        "south-east", "south-west", "north-east", "north-west")

# Sniff each ZIP for entries matching each source prefix
written = {p: set() for _, p, _ in SOURCES}
for zip_path in ZIPS:
    if not zip_path.exists():
        print(f"missing zip: {zip_path}")
        continue
    with zipfile.ZipFile(zip_path) as zf:
        for entry in zf.namelist():
            # Match: <anything>/animations/<prefix>-<hash>/<dir>/frame_<NNN>.png
            m = re.search(
                r"animations/([^/]+)/([^/]+)/frame_(\d+)\.png$", entry)
            if not m:
                continue
            anim_name, direction, frame_str = m.group(1), m.group(2), m.group(3)
            if direction not in DIRS:
                continue
            for prefix, pose, is_v3 in SOURCES:
                if not anim_name.startswith(prefix):
                    continue
                frame_idx = int(frame_str)
                # Spin uses 8 frames; everything else uses 4.
                max_frames = 8 if pose == "spin" else 4
                if is_v3:
                    # Skip the reference frame; remap 1..N -> 0..N-1
                    if frame_idx == 0:
                        continue
                    out_frame = frame_idx - 1
                else:
                    # Template uses 0..N-1 directly
                    out_frame = frame_idx
                if out_frame >= max_frames:
                    continue
                target_dir = ROOT / pose
                target_dir.mkdir(exist_ok=True)
                out_path = target_dir / f"{direction}_{out_frame}.png"
                with zf.open(entry) as src, open(out_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                written[pose].add((direction, out_frame))
                break

for pose, entries in written.items():
    full = len(entries)
    print(f"{pose}: wrote {full} frames "
          f"({len({d for d,_ in entries})} directions)")
