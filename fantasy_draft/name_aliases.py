"""xlsx -> canonical-player-name resolution.

MONEY_LEAGUE.xlsx (the source of truth for keeper history) is hand-typed
across 11 years, so it contains misspellings, nicknames, owner-name
admin entries, and inconsistent defense formats. This module normalizes
those quirks so historical keepers can be joined to the current Sleeper
player catalog for position lookup, ADP, projections, etc.

Three pieces:

  OWNER_NAMES_EXCLUDE  — strings to drop entirely (team owner names and
                         admin labels that bleed into the parsed grid
                         on older 2015-2018 layouts).

  DEFENSE_ALIASES      — xlsx defense variants -> canonical "City Team"
                         format used in Sleeper's catalog
                         (e.g. "Eagles D" -> "Philadelphia Eagles").

  PLAYER_ALIASES       — xlsx player typos / nicknames -> canonical name
                         (e.g. "Christian Mcaffery" -> "Christian
                         McCaffrey", "Gronk" -> "Rob Gronkowski").

Use resolve_xlsx_name(raw) to get the canonical name (or None to skip).
"""
from __future__ import annotations


OWNER_NAMES_EXCLUDE: set[str] = {
    # League-member nicknames that appear in 2015-2018 admin columns.
    "Coop", "Lem", "Donnie", "Wang", "Eric", "Nark", "Bgu", "Trevor",
    "Troy", "Ryan", "Figgy", "Tim", "Brian", "Dave", "Josh", "Watt?",
    # Spreadsheet header / admin labels.
    "Color", "Hotel", "Hotel Cost", "Dues", "Team", "Paid?", "Paid",
    "Amount", "Needed", "Total", "Week", "Low Scores", "Notes:",
    "Draft Order", "Half Point PPR", "Dudes who cannot be kept",
    "Extra people Sleeping on floor", "Dudes who cann", "Yes", "No",
}


# Build the 32 NFL defenses from the Sleeper canonical format.
_NFL_TEAMS: dict[str, str] = {
    "ARI": "Arizona Cardinals",   "ATL": "Atlanta Falcons",
    "BAL": "Baltimore Ravens",    "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers",   "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals",  "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys",      "DEN": "Denver Broncos",
    "DET": "Detroit Lions",       "GB":  "Green Bay Packers",
    "HOU": "Houston Texans",      "IND": "Indianapolis Colts",
    "JAX": "Jacksonville Jaguars","KC":  "Kansas City Chiefs",
    "LAC": "Los Angeles Chargers","LAR": "Los Angeles Rams",
    "LV":  "Las Vegas Raiders",   "MIA": "Miami Dolphins",
    "MIN": "Minnesota Vikings",   "NE":  "New England Patriots",
    "NO":  "New Orleans Saints",  "NYG": "New York Giants",
    "NYJ": "New York Jets",       "PHI": "Philadelphia Eagles",
    "PIT": "Pittsburgh Steelers", "SEA": "Seattle Seahawks",
    "SF":  "San Francisco 49ers", "TB":  "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans",    "WAS": "Washington Commanders",
}


DEFENSE_ALIASES: dict[str, str] = {
    # City + suffix variants
    "Arizona D": "Arizona Cardinals",   "arizona d": "Arizona Cardinals",
    "Atlanta D": "Atlanta Falcons",
    "Baltimore D": "Baltimore Ravens",
    "Buffalo D": "Buffalo Bills",
    "Carolina D": "Carolina Panthers",
    "Chicago Bears D": "Chicago Bears",
    "Cleveland D": "Cleveland Browns",
    "Dallas D": "Dallas Cowboys",
    "Denver": "Denver Broncos",         "Denver D": "Denver Broncos",
    "Houston D": "Houston Texans",
    "Jacksonville D": "Jacksonville Jaguars",
    "Kansas City": "Kansas City Chiefs",
    "LOS ANGELES": "Los Angeles Rams",  # 2015-era; only Rams existed in LA before 2017
    "Pittsburg D": "Pittsburgh Steelers",
    "Seattle": "Seattle Seahawks",      "Seattle D": "Seattle Seahawks",
    "St Louis D": "Los Angeles Rams",   # Rams pre-2016 move; Sleeper uses LAR
    "TENNESSEE": "Tennessee Titans",
    "PANTHERS": "Carolina Panthers",
    # Team-name + " D" or " Defense" or " Def" suffix
    "49ers D": "San Francisco 49ers",   "Niners Def": "San Francisco 49ers",
    "Bears D": "Chicago Bears",
    "Bills D": "Buffalo Bills",
    "Broncos D": "Denver Broncos",
    "Browns D": "Cleveland Browns",
    "Buccs Defense": "Tampa Bay Buccaneers",
    "Bucs D": "Tampa Bay Buccaneers",
    "Cardinals D": "Arizona Cardinals",
    "Chargers D": "Los Angeles Chargers",
    "Chiefs D": "Kansas City Chiefs",
    "Colts D": "Indianapolis Colts",    "colts D": "Indianapolis Colts",
    "Commanders D": "Washington Commanders",
    "Cowboys D": "Dallas Cowboys",
    "Dolphins D": "Miami Dolphins",
    "Eagles D": "Philadelphia Eagles",
    "Falcons D": "Atlanta Falcons",
    "Giants D": "New York Giants",
    "GreenBay D": "Green Bay Packers",
    "Jags D": "Jacksonville Jaguars",
    "Jets D": "New York Jets",
    "Lions D": "Detroit Lions",
    "MInnesota D": "Minnesota Vikings",
    "New england D": "New England Patriots",
    "Packers D": "Green Bay Packers",
    "Patriots D": "New England Patriots",
    "Pats D": "New England Patriots",
    "Rams D": "Los Angeles Rams",       "Rams Defense": "Los Angeles Rams",
    "Ravens D": "Baltimore Ravens",
    "Saints D": "New Orleans Saints",
    "Steelers D": "Pittsburgh Steelers",
    "Texans D": "Houston Texans",
    "Titans D": "Tennessee Titans",
    "Vikings D": "Minnesota Vikings",
    "WFT def": "Washington Commanders",  # Washington Football Team era
    # Abbreviation + "D/ST" variants
    "BUF D/ST": "Buffalo Bills",
    "CHI D/ST": "Chicago Bears",
    "KC D": "Kansas City Chiefs",       "KC D/ST": "Kansas City Chiefs",
    "LAC D/ST": "Los Angeles Chargers",
    "MIN D/ST": "Minnesota Vikings",
    "NE D/ST": "New England Patriots",
    "NO D/ST": "New Orleans Saints",
    "PHI D/ST": "Philadelphia Eagles",
    "PIT D/ST": "Pittsburgh Steelers",
    "SF D": "San Francisco 49ers",
    "SF D/ST (Team Rocket)": "San Francisco 49ers",
}


PLAYER_ALIASES: dict[str, str] = {
    # ---- Joke / nickname / shorthand mappings ----
    "Big Ben": "Ben Roethlisberger",
    "Gronk": "Rob Gronkowski",
    "Hollywood Brown": "Marquise Brown",
    "Pat Mahomes": "Patrick Mahomes",
    "Phil Rivers": "Philip Rivers",
    "Phillip Rivers": "Philip Rivers",
    "RG3": "Robert Griffin III",
    "Ryan Fitz": "Ryan Fitzpatrick",
    "Saquon God": "Saquon Barkley",
    "Tua Tunnilingus": "Tua Tagovailoa",
    "tua": "Tua Tagovailoa",
    "Tyler Bass Kicker": "Tyler Bass",
    "Wentz": "Carson Wentz",
    "Zeke": "Ezekiel Elliott",
    "Koo": "Younghoe Koo",
    "Young Hoe Koo": "Younghoe Koo",
    "Younghoe": "Younghoe Koo",
    "YungHoe": "Younghoe Koo",
    "Gostkowski": "Stephen Gostkowski",
    "Hoyer": "Brian Hoyer",
    "Fairbairn": "Ka'imi Fairbairn",
    "Buck Allen": "Javorius Allen",
    "Tony Jones mr": "Tony Jones",
    "autism hooper": "Austin Hooper",
    "bobby turbo": "Robert Turbin",
    "Crows Hoes/Crowell": "Isaiah Crowell",
    "Naheen Hines": "Nyheim Hines",
    "Alvin Kamara fuck saquon": "Alvin Kamara",
    "pHiLlIp lInDsEy": "Phillip Lindsay",
    # ---- Player typos ----
    "Adam Theilen": "Adam Thielen",
    "Allan Lazard": "Allen Lazard",
    "Austin Sef Jenkins": "Austin Seferian-Jenkins",
    "Ben Rothelsberzg": "Ben Roethlisberger",
    "Bershad Perriman": "Breshad Perriman",
    "Brandon Cooks": "Brandin Cooks",
    "Brandon McMannus": "Brandon McManus",
    "Brandon Oliver": "Branden Oliver",
    "C J Anderson": "C.J. Anderson",
    "Cameron Maredith": "Cameron Meredith",
    "Chandler Cantanzaro": "Chandler Catanzaro",
    "Chigoziem Okonkwo": "Chig Okonkwo",
    "Christian McCafferty": "Christian McCaffrey",
    "Christian Mcaffery": "Christian McCaffrey",
    "Christian Mccaffery": "Christian McCaffrey",
    "Clyde Edwards Hilare": "Clyde Edwards-Helaire",
    "Cody Lattimer": "Cody Latimer",
    "Cordarelle Patterson": "Cordarrelle Patterson",
    "DK Metcalfe": "DK Metcalf",
    "Dak Presscot": "Dak Prescott",
    "Dalton Shultz": "Dalton Schultz",
    "Dalvin Cooks": "Dalvin Cook",
    "Dalvin Cuck": "Dalvin Cook",
    "Dan Carlson": "Daniel Carlson",
    "Davante Parker": "DeVante Parker",
    "DeVanta Smith": "DeVonta Smith",
    "Deandre Swift": "D'Andre Swift",
    "Deante Foreman": "D'Onta Foreman",
    "Delaine Walker": "Delanie Walker",
    "Demarius Thomas": "Demaryius Thomas",
    "Demaryious Thomas": "Demaryius Thomas",
    "Derek Henry": "Derrick Henry",
    "Desean Hamilton": "DaeSean Hamilton",
    "Devanta Freeman": "Devonta Freeman",
    "Devante Adams": "Davante Adams",
    "Devin Singletery": "Devin Singletary",
    "Devonte Freeman": "Devonta Freeman",
    "Devonte Parker": "DeVante Parker",
    "Devonte Smith": "DeVonta Smith",
    "Dionte Johnson": "Diontae Johnson",
    "Doriel Green B": "Dorial Green-Beckham",
    "Eli Mitchell": "Elijah Mitchell",
    "Elijah Mitchel": "Elijah Mitchell",
    "Emmanuel Sander": "Emmanuel Sanders",
    "Evan Mcphearson": "Evan McPherson",
    "Ezekeil Elliot": "Ezekiel Elliott",
    "Ezekiel Elliot": "Ezekiel Elliott",
    "Gabriel Davis": "Gabe Davis",
    "Gardner Minchew": "Gardner Minshew",
    "Garett Wilson": "Garrett Wilson",
    "Gio BErnard": "Giovani Bernard",
    "Gio Bernard": "Giovani Bernard",
    "Greg Zuerlin": "Greg Zuerlein",
    "Ino Benjamin": "Eno Benjamin",
    "Issac Guerendo": "Isaac Guerendo",
    "JUJU smith Shuster": "JuJu Smith-Schuster",
    "Ju Ju Smith Shuster": "JuJu Smith-Schuster",
    "JuJu Smith Shuster": "JuJu Smith-Schuster",
    "Jackson Dart": "Jaxson Dart",
    "Jacobi Meyers": "Jakobi Meyers",
    "Jaemis Winston": "Jameis Winston",
    "Jaimis Winston": "Jameis Winston",
    "Jake Elliot": "Jake Elliott",
    "Jalen Raegor": "Jalen Reagor",
    "Jalen Reager": "Jalen Reagor",
    "Jamal Williams": "Jamaal Williams",
    "Jamar Chase": "Ja'Marr Chase",
    "James Connor": "James Conner",
    "Jamies Winston": "Jameis Winston",
    "Jaquizz Rodgerw": "Jacquizz Rodgers",
    "Jimmy Garapolo": "Jimmy Garoppolo",
    "Jimmy Garapollo": "Jimmy Garoppolo",
    "Jimmy Garappololol": "Jimmy Garoppolo",
    "Jimmy Garrapollo": "Jimmy Garoppolo",
    "Jon Ross": "John Ross",
    "Julian Edleman": "Julian Edelman",
    "Ka'iami Fairbairn": "Ka'imi Fairbairn",
    "Keenen Allen": "Keenan Allen",
    "Ken Walker": "Kenneth Walker",
    "Kenny Gainwell": "Kenneth Gainwell",
    "Kenny Galloday": "Kenny Golladay",
    "Kyle Rudolf": "Kyle Rudolph",
    "LaGarrette Blount": "LeGarrette Blount",
    "Lagarrette Blount": "LeGarrette Blount",
    "LeVean Bell": "Le'Veon Bell",
    "Leviska Shenault": "Laviska Shenault",
    "Luke Mccaffery": "Luke McCaffrey",
    "Malik Wilis": "Malik Willis",
    "Marques Brown": "Marquise Brown",
    "Marques Calloway": "Marquez Callaway",
    "Marques Lee": "Marqise Lee",
    "Marquise Lee": "Marqise Lee",
    "Martavius Bryant": "Martavis Bryant",
    "Mathew Stafford": "Matthew Stafford",
    "Matt Stafford": "Matthew Stafford",
    "Micheal Badgley": "Michael Badgley",
    "Mike Badgley": "Michael Badgley",
    "Mike Gilleslee": "Mike Gillislee",
    "Mike Giseki": "Mike Gesicki",
    "Mitch Trubisky": "Mitchell Trubisky",
    "Mohammad Sanu": "Mohamed Sanu",
    "Nelson Agolor": "Nelson Agholor",
    "Nelson Alghalor": "Nelson Agholor",
    "Nyheim Hines": "Nyheim Miller-Hines",
    "Paris Campbell": "Parris Campbell",
    "Pariss Campbell": "Parris Campbell",
    "Pat Fiermeuth": "Pat Freiermuth",
    "Pat Frierumuth": "Pat Freiermuth",
    "Philip Dorsett": "Phillip Dorsett",
    "Philip Lindsay": "Phillip Lindsay",
    "Quentin Johnson": "Quentin Johnston",
    "Rashad Bateman": "Rashod Bateman",
    "Rashad White": "Rachaad White",
    "Rashod Batemen": "Rashod Bateman",
    "Rhamandre Steveson": "Rhamondre Stevenson",
    "Rishard Mathews": "Rishard Matthews",
    "Ryan Matthews": "Ryan Mathews",
    "Ryquel Armstead": "Ryquell Armstead",
    "Stefan Diggs": "Stefon Diggs",
    "Stephen Diggs": "Stefon Diggs",
    "Stephon Diggs": "Stefon Diggs",
    "Sterling Shepherd": "Sterling Shepard",
    "Steven Hauschka": "Stephen Hauschka",
    "Steven Haushcka": "Stephen Hauschka",
    "Steven Haushka": "Stephen Hauschka",
    "TJ Hoskonson": "T.J. Hockenson",
    "Tayson Hill": "Taysom Hill",
    "Tee Higgens": "Tee Higgins",
    "Todd Girley": "Todd Gurley",
    "Trequon Smith": "Tre'Quan Smith",
    "Tyler Eiffert": "Tyler Eifert",
    "Will Fuller": "William Fuller",
    "Will Lutz": "Wil Lutz",
    "Zach Charbonet": "Zach Charbonnet",
    "Zack Miller": "Zach Miller",
    # ---- Players who really have no Sleeper-catalog entry, left untouched ----
    # "Robby Anderson" / "Robbieyy Anderson" -- Sleeper catalog has neither
    #   "Robby" nor "Robbie" Anderson; the player legally changed his name to
    #   Robbie Chosen. Letting these flow through; they'll show as '?' position.
}


# Lowercased view so resolve_xlsx_name is case-insensitive for typos.
_DEF_LC = {k.lower(): v for k, v in DEFENSE_ALIASES.items()}
_PLAYER_LC = {k.lower(): v for k, v in PLAYER_ALIASES.items()}
_OWNER_LC = {n.lower() for n in OWNER_NAMES_EXCLUDE}


def resolve_xlsx_name(raw: str) -> str | None:
    """Map an xlsx cell value to its canonical Sleeper player name.

    Returns None for entries that should be skipped entirely (owner names,
    admin labels, blanks). Returns the raw stripped name unchanged when no
    alias is needed.
    """
    if raw is None:
        return None
    name = str(raw).strip()
    if not name:
        return None
    lc = name.lower()
    if lc in _OWNER_LC:
        return None
    if lc in _DEF_LC:
        return _DEF_LC[lc]
    if lc in _PLAYER_LC:
        return _PLAYER_LC[lc]
    return name
