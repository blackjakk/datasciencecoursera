// ─── Player generation ────────────────────────────────────────────────────
// Sprawling, multi-cultural name pool. American + biblical + international
// (German, Italian, Polish, Hispanic, Japanese, Korean, Polynesian/Samoan).
// Spelling variants (Brendan/Brenden, Müller/Mueller, Jürgen/Juergen) are
// included so two players can share a phonetic name but read distinctly.
// Creative D'/Ja'/La' names get generated on the fly to add freshness.
// pickLastName() rolls a chance for a hyphenated double-barrel last name.
const FIRST = [
  // Modern American — common (heavily expanded so pop-culture names dilute
  // into the background)
  "Marcus","Markus","Marqus","Tyler","Tylar","Darius","Dareius","Daryus","Jordan","Jordon",
  "Malik","Mahleek","Malek","Devon","Devyn","Devontae","Xavier","Cameron","Kameron","Jaylen",
  "Jaelen","Jalen","Trevor","Trevour","Nathan","Nathen","Brandon","Branden","Brendan","Brenden",
  "Brennan","Derrick","Derek","Antonio","Anthony","Deon","Travon","Rasheed","Quincy","Zach",
  "Zack","Zackary","Hunter","Brayden","Braden","Braiden","Cole","Coll","Jake","Jaykob","Ryan",
  "Ryne","Rion","Luke","Lukas","Lucas","Evan","Aaron","Aron","Chris","Cris","Jamal","Tyrone",
  "Lamar","Lamarr","Andre","Aundre","Reggie","Reggi","Stefon","Stefan","Stephon","Amari","Cooper",
  "Travis","Cam","Justin","Jusstyn","Dak","Patrick","Patric","Kyler","Bryce","Brice","Joe",
  "Christian","Kristian","Najee","Sterling","Trenton","Trentin","Bryson","Brycen","Jaxon",
  "Jaxson","Jacksen","Kade","Drake","Maverick","Hayden","Haiden","Walker","Sawyer","Easton",
  "Tate","Beckett","Cason","Karsten","Carsten","Tanner","Kellen","Kellan","Knox","Wyatt","Wyat",
  "Greyson","Grayson","Sutton","Briggs","Boone",
  // Top common American given names — drawn from real US census data
  "Michael","James","Robert","John","William","Richard","Charles","Joseph","Donald","Steven",
  "Andrew","Kenneth","Kevin","Edward","Paul","George","Brian","Mark","Jason","Jeff","Gary",
  "Larry","Frank","Scott","Eric","Stephen","Raymond","Dennis","Jerry","Walter","Peter","Harold",
  "Douglas","Adam","Arthur","Lawrence","Albert","Roy","Eugene","Wayne","Mason","Ethan","Logan",
  "Jacob","Owen","Lincoln","Sebastian","Henry","Jack","Ben","Benjamin","Theo","Theodore",
  "Liam","Noah","Oliver","Charlie","Carter","Dylan","Alexander","Connor","Jonathan","Jeremy",
  "Greg","Russell","Bobby","Jimmy","Tommy","Joey","Mike","Steve","Dave","Rob","Ricky","Billy",
  "Sam","Sammy","Will","Willy","Nick","Nico","Tony","Frankie","Charlie","Eddie","Teddy","Vince",
  "Vinny","Sal","Sully","Buddy","Hank","Pete","Don","Donny","Lenny","Manny","Marty","Mickey",
  "Tommy","Wally","Jimmy","Bobby","Jake","Toby","Rusty","Vinnie","Curt","Kurt","Marv","Murph",
  "Brendon","Reid","Quinn","Riley","Garrett","Brett","Brock","Chase","Trent","Trey","Trae","Drew",
  "Blake","Brady","Cody","Casey","Colby","Colton","Dawson","Derek","Dustin","Garrison","Graham",
  "Holden","Hayes","Jett","Kane","Keaton","Korbin","Landon","Levi","Lyle","Mac","Mack","Miles",
  "Nolan","Nash","Pierce","Reece","Rhett","Rocco","Rocky","Sully","Tucker","Wesley","Wes",
  "Zane","Zeke","Cory","Cory","Brent","Buddy","Chuck","Curt","Dale","Dean","Dirk","Doug","Ernie",
  "Floyd","Glenn","Hal","Herb","Ira","Jerry","Karl","Lance","Leon","Lou","Marvin","Max","Milt",
  "Monte","Otis","Ralph","Sid","Stan","Vern","Wendell","Woody","Wyatt","Vance","Tucker",
  // Modern Black American / rapper-inspired first-name patterns. These follow
  // the linguistic style without being literal stage names — DeAndre, Marquise,
  // Davion, etc. are common NFL first names.
  "DeAndre","DeAndré","DeOndre","DeShawn","DeSean","DeMarcus","DeMario","DeVonte","DeVantae",
  "Demarius","Damari","Damarion","Damarcus","Devonte","Davion","Davaughn","Davonte","Daquan",
  "Daquarius","DaQuan","Darnell","Devontay","Deontay","Deontae","Donte","Donté","Donovan",
  "Donny","Donyell","Darnel","Darreon","Darian","Dareion","Darrius","Markeese","Marquise",
  "Marqueese","Marquez","Marquice","Marquell","Marshawn","Tarvarius","Tarvarus","Tre","Trey",
  "Trae","Trayvon","Treyvon","Trayveon","Tyriq","Tyrique","Tyron","Tariq","Quavion","Quavari",
  "Quavante","Quavan","Quincy","Quinten","Quinton","Quenton","Quinten","Quentavius","Quay",
  "Quan","Quez","Vez","Zay","Zaire","Zayn","Zayde","Cuse","Cee","Dre","Drey","Quavo","Cordae",
  "Polo","Roddy","Latto","Jeezy","Saweetie","Trippie","Lupe","Cyhi","Maino","Pusha","Plies",
  "Boosie","NLE","Nelly","Future","Tory","Wale","Yachty","Trinidad","Migos","Stat","Slim",
  "Mookie","Boogie","Hustle","Black","Tobe","Tee","Vee","Bee","Ace","Brey","Quay","Quan",
  // Acronym-style initials (J.J. Watt, T.J. Watt, A.J. Brown, C.J. Stroud)
  "J.J.","T.J.","A.J.","D.J.","R.J.","C.J.","M.J.","B.J.","L.J.","K.J.","O.J.","E.J.",
  "P.J.","N.J.","K.D.","O.D.","D'J.","T.J.","Y.K.","X.K.",
  // Biblical (subtle, most read as normal American)
  "Daniel","Danyel","David","Davyd","Joshua","Joshuah","Samuel","Samual","Eli","Ezra","Esra",
  "Josiah","Josyah","Micah","Mykah","Asher","Levi","Caleb","Kaleb","Kayleb","Isaiah","Izaiah",
  "Elijah","Elija","Gideon","Boaz","Silas","Sylas","Ezekiel","Jonah","Jonas","Jeremiah",
  // Japanese
  "Hiroshi","Kenji","Daichi","Haruto","Yuki","Sho","Takuya","Ryo","Akira","Kazuki",
  "Riku","Yuta","Sota","Kaito","Renji","Tatsuya","Hayato","Souta","Tsubasa","Daiki",
  // Korean
  "Min-jun","Hyun","Jin","Sung","Joon","Tae","Dong","Seung","Jisoo","Beom",
  // Polynesian (Samoan/Tongan/Maori)
  "Tua","Penei","Tuli","Mosi","Lavaka","Vita","Aolelei","Sefo","Manu","Tevita","Sione","Lopeti",
  // German / Austrian (with umlaut/non-umlaut variants)
  "Lukas","Maximilian","Stefan","Otto","Rolf","Wolfgang","Jürgen","Juergen","Hartmut","Sebastian",
  "Klaus","Niklas","Bastian","Florian","Kai","Anders","Björn","Bjoern","Günther","Guenther",
  // Italian (with diacritic variants)
  "Marco","Luca","Matteo","Alessandro","Lorenzo","Gianluca","Giovanni","Dante","Niccolò","Niccolo",
  // Hispanic / Latin (with diacritics)
  "Diego","Mateo","Santiago","Carlos","Javier","Andrés","Andres","Rafa","Emilio","Joaquín",
  "Joaquin","Cristián","Cristian","Adrián","Adrian","Iván","Ivan","René","Rene",
  // Scandinavian / Slavic
  "Anders","Magnus","Henrik","Bjorn","Olek","Tadek","Kacper","Filip","Janek","Mikkel","Søren","Soren",
  // West African
  "Kwame","Kofi","Sefu","Bayo","Adisa","Femi","Tunde","Kenan",
  // Brazilian / Portuguese
  "Caio","Thiago","Rodrigo","Vinicius","João","Joao","Murilo","Vinícius",
  // Hyphenated double firsts (sprinkle)
  "Jean-Paul","Jean-Luc","Pierre-Marc","Hans-Peter","Karl-Heinz","Juan-Carlos","Marco-Antonio",
  // Russian / Slavic
  "Dmitri","Boris","Nikolai","Igor","Sergei","Pavel","Mikhail","Yuri","Viktor","Alexei",
  // Middle Eastern / Arabic
  "Tariq","Khalid","Omar","Ahmed","Yusuf","Hassan","Karim","Faisal","Bilal","Rashid",
  // Indian / Sanskrit
  "Arjun","Krishna","Rajiv","Vikram","Sanjay","Aditya","Raj","Dev","Kabir","Rohan",
  // Hawaiian / Pacific
  "Kainoa","Makoa","Keoni","Kalani","Akoni","Kona","Nainoa",
  // Native American (modern usage)
  "Cheyenne","Dakota","Sequoia",
  // Greek mythology
  "Atlas","Achilles","Hector","Ajax","Apollo","Ares","Theseus","Perseus","Heracles","Odysseus",
  "Cassius","Brutus","Leonidas","Orion","Castor","Polydeuces","Aeneas",
  // Norse mythology
  "Thor","Odin","Loki","Tyr","Bragi","Freyr","Baldur","Magnus","Ragnar",
  // Game of Thrones
  "Jon","Robb","Bran","Ned","Eddard","Sandor","Jaime","Theon","Tormund","Aemon",
  "Stannis","Renly","Petyr","Gregor","Bronn","Davos","Samwell","Podrick","Mance","Tywin",
  "Doran","Oberyn","Tyrion","Jorah",
  // Star Wars
  "Anakin","Han","Lando","Mace","Boba","Jango","Kylo","Finn","Poe","Cassian","Bodhi",
  "Galen","Saw","Cal","Ezra","Kanan",
  // Lord of the Rings
  "Aragorn","Frodo","Bilbo","Gandalf","Legolas","Gimli","Boromir","Faramir","Eomer","Theoden",
  "Elrond","Pippin","Merry","Beregond","Halbarad","Imrahil",
  // The Matrix
  "Morpheus","Neo","Cypher",
  // Dune
  "Paul","Duncan","Stilgar","Leto","Gurney","Idaho","Liet",
  // Breaking Bad / pop classics
  "Walter","Jesse","Saul","Mike","Tuco","Hank",
  // Anime (Dragon Ball, Naruto, etc.)
  "Goku","Vegeta","Trunks","Gohan","Krillin","Naruto","Itachi","Sasuke","Kakashi",
  // Marvel / DC heroes
  "Logan","Bruce","Steve","Peter","Clark","Wade","Tony","Stephen","Scott","Hal",
  // Cultural significants from other angles
  "Cyrus","Darius","Hannibal","Spartacus","Genghis","Attila","Augustus",
  // Roman names (emperors, generals, philosophers)
  "Caesar","Lucius","Maximus","Octavian","Aurelius","Cato","Tiberius","Trajan","Nero","Vespasian",
  "Hadrian","Cicero","Crassus","Pompey","Sulla","Constantine","Diocletian","Antoninus",
  // Greek (philosophers, kings, heroes — not in mythology block)
  "Alexander","Aristotle","Plato","Socrates","Pythagoras","Pericles","Themistocles","Leonidas",
  "Stavros","Petros","Yannis","Dimitris","Nikolaos","Konstantinos",
  // Egyptian (pharaohs and gods used as names)
  "Ramses","Khufu","Akhenaten","Thutmose","Senusret","Imhotep","Ptolemy","Khaemwaset","Tutankhamun",
  "Anubis","Horus","Osiris","Sobek","Khepri",
  // Celtic / Welsh / Irish
  "Cormac","Conor","Lorcan","Padraig","Niall","Eoin","Owen","Bran","Bronn","Rhys","Dafydd",
];

const LAST = [
  // Modern American — common (heavily expanded so pop-culture names dilute)
  "Johnson","Williams","Brown","Jones","Davis","Miller","Wilson","Moore","Taylor","Anderson",
  "Thomas","Jackson","White","Harris","Martin","Thompson","Robinson","Clark","Lewis","Lee",
  "Walker","Hall","Allen","Young","Hill","Green","Adams","Nelson","Baker","Carter",
  "Mitchell","Roberts","Turner","Phillips","Campbell","Reed","Brooks","Bell","Reeves","Coleman",
  "Hayes","Bryant","Ford","Knight","Banks","Stone","Vaughn","Rivers","Shaw","Lane",
  // Top common US surnames — drawn from census data
  "Wright","Hughes","Watson","Edwards","Collins","Stewart","Morris","Murphy","Cook","Cooper",
  "Richardson","Cox","Howard","Ward","Peterson","Gray","James","Kelly","Sanders","Price",
  "Bennett","Wood","Barnes","Ross","Henderson","Jenkins","Perry","Powell","Long","Patterson",
  "Washington","Butler","Simmons","Foster","Gonzales","Alexander","Russell","Griffin","Hamilton",
  "Graham","Sullivan","Wallace","Woods","Cole","West","Owens","Reynolds","Fisher","Ellis",
  "Harrison","Gibson","Cruz","Marshall","Gomez","Murray","Freeman","Wells","Webb","Simpson",
  "Stevens","Tucker","Porter","Hunter","Hicks","Crawford","Henry","Boyd","Mason","Morales",
  "Kennedy","Warren","Dixon","Ramos","Burns","Gordon","Holmes","Rice","Robertson","Hunt",
  "Black","Daniels","Palmer","Mills","Nichols","Grant","Ferguson","Rose","Hawkins","Dunn",
  "Perkins","Hudson","Spencer","Gardner","Stephens","Payne","Pierce","Berry","Matthews","Arnold",
  "Willis","Ray","Watkins","Olson","Carroll","Duncan","Snyder","Hart","Cunningham","Bradley",
  "Andrews","Ruiz","Harper","Fox","Riley","Armstrong","Carpenter","Weaver","Greene","Lawrence",
  "Elliott","Chavez","Sims","Austin","Peters","Kelley","Franklin","Lawson","Fields","Gutierrez",
  "Ryan","Carr","Vasquez","Wheeler","Chapman","Oliver","Montgomery","Richards","Williamson",
  "Johnston","Meyer","Bishop","McCoy","Howell","Alvarez","Morrison","Hansen","Fernandez","Garza",
  "Harvey","Little","Burton","Stanley","Nguyen","George","Jacobs","Reid","Fuller","Lynch","Dean",
  "Gilbert","Garrett","Romero","Welch","Larson","Frazier","Burke","Hanson","Day","Moreno",
  "Bowman","Medina","Fowler","Brewer","Carlson","Pearson","Holland","Douglas","Fleming","Jensen",
  "Vargas","Byrd","Davidson","Hopkins","May","Terry","Herrera","Wade","Soto","Walters","Curtis",
  "Neal","Caldwell","Lowe","Jennings","Barnett","Graves","Jimenez","Horton","Shelton","Barrett",
  "Castro","Sutton","Gregory","McKinney","Lucas","Miles","Craig","Chambers","Holt","Lambert",
  "Fletcher","Watts","Bates","Hale","Rhodes","Pena","Beck","Newman","Haynes","McDaniel","Bush",
  "Parks","Dawson","Santiago","Norris","Hardy","Love","Steele","Curry","Powers","Schultz",
  "Barker","Guzman","Page","Munoz","Ball","Keller","Chandler","Leonard","Walsh","Lyons","Ramsey",
  "Wolfe","Mullins","Benson","Sharp","Bowen","Barber","Cummings","Hines","Baldwin","Griffith",
  "Valdez","Hubbard","Salazar","Warner","Stevenson","Burgess","Tate","Cross","Garner","Mann",
  "Mack","Moss","Thornton","Dennis","McGee","Farmer","Delgado","Aguilar","Vega","Glover","Manning",
  "Harmon","Rodgers","Robbins","Newton","Todd","Blair","Higgins","Ingram","Reese","Cannon",
  "Strickland","Townsend","Potter","Goodwin","Walton","Rowe","Hampton","Ortega","Patton","Swanson",
  "Joseph","Francis","Maldonado","Yates","Erickson","Hodges","Rios","Conner","Adkins","Webster",
  "Norman","Malone","Hammond","Flowers","Cobb","Moody","Quinn","Blake","Maxwell","Pope","Floyd",
  "Osborne","McCarthy","Guerrero","Lindsey","Estrada","Sandoval","Gibbs","Tyler","Gross","Stokes",
  "Doyle","Sherman","Saunders","Wise","Colon","Gill","Greer","Padilla","Simon","Waters","Nunez",
  "Ballard","McBride","Houston","Christensen","Pratt","Briggs","Parsons","McLaughlin","Zimmerman",
  "French","Buchanan","Moran","Copeland","Pittman","Brady","McCormick","Holloway","Brock","Poole",
  "Logan","Bass","Marsh","Wong","Jefferson","Morton","Abbott","Sparks","Norton","Huff","Clayton",
  "Massey","Lloyd","Figueroa","Carson","Bowers","Roberson","Barton","Tran","Lamb","Harrington",
  "Casey","Cortez","Clarke","Mathis","Singleton","Wilkins","Cain","Bryan","Underwood","Hogan",
  "McKenzie","Collier","Luna","Phelps","McGuire","Allison","Bridges","Wilkerson","Nash","Summers",
  "Atkins","Wilcox","Pitts","Conley","Marquez","Burnett","Cochran","Chase","Davenport","Hood",
  "Gates","Clay","Ayala","Roman","Vaughan","Velasquez","Holder","Herring","Wilkinson","Buck",
  "Harden","Lara","Solis","Robles","Cervantes","Ochoa","Suarez","Salinas","Velez","Hidalgo",
  // Irish / Scottish (apostrophes and Mc/Mac)
  "O'Brien","O'Connor","O'Donnell","O'Sullivan","O'Malley","O'Reilly","McDonald","MacDonald",
  "McAllister","McKinnon","McCarthy","McGregor","McKinley","MacIntyre","Fitzgerald","Fitzpatrick",
  // Biblical / Hebrew
  "Cohen","Levi","Solomon","Abrams","Levy","Mendoza","Salem","Friedman","Klein",
  // German / Austrian (BOTH umlaut + ASCII variants)
  "Schmidt","Müller","Mueller","Schneider","Schäfer","Schaefer","Hochuli","Wagner","Becker","Hoffmann",
  "Schulz","Volk","Bauer","Klose","Weber","Fischer","Kraus","Vogel","Schwartz","Hertz",
  "Roth","Brandt","Köhler","Koehler","Größe","Grosse","Häuser","Haeuser","Förster","Foerster",
  // Italian (diacritics + plain)
  "Romano","Rossi","Esposito","Mancini","Russo","Ferrari","Conti","Marino","Bruno","Bianchi",
  "Ricci","Lombardi","Greco","Costa","Bellucci","Capello","D'Amato","D'Angelo","Di Carlo",
  // Polish / Eastern European
  "Lewandowski","Wojcik","Kowalski","Nowak","Krzyzewski","Kubiak","Konecki","Stankowski",
  "Pawlowski","Jankowski","Zielinski","Kaminski","Mazur","Kowalczyk",
  // Hispanic (with accent variants)
  "Garcia","García","Martinez","Martínez","Hernandez","Hernández","Lopez","López","Gonzalez",
  "González","Perez","Pérez","Sanchez","Sánchez","Ramirez","Ramírez","Torres","Rivera","Sosa",
  "Cabrera","Diaz","Díaz","Reyes","Flores","Castillo","Mendez","Méndez","Alvarado","Ortiz",
  // Japanese
  "Tanaka","Suzuki","Sato","Takahashi","Watanabe","Ito","Yamamoto","Nakamura","Kobayashi","Yoshida",
  "Yamada","Sasaki","Matsumoto","Kondo","Saito","Endo","Hayashi","Ishikawa","Shimizu",
  // Korean
  "Kim","Park","Choi","Jung","Kang","Lim","Han","Shin","Yoon","Cho",
  // Polynesian
  "Tagovailoa","Tuilagi","Faaleava","Mahuta","Tavai","Manumaleuna","Tuipulotu","Faleafine","Sapolu",
  "Aumavae","Toilolo","Vaeao",
  // West African
  "Adebayo","Okafor","Nwosu","Mbappe","Mbappé","Diallo","Sissoko","Owusu","Asare","Boateng",
  // Brazilian / Portuguese
  "Silva","Santos","Oliveira","Pereira","Costa","Almeida","Soares","Cardoso",
  // Invented / brand-flavored — adds "alive" feeling without being on-the-nose
  "Apple","Cherry","Maple","Mercedes","Cobra","Lemon","Cadillac","Crowne","Diamond","Ironside",
  "Pomelo","Olive","Brookstone","Aspen","Cypress","Magnolia","Indigo","Ember","Vesper","Onyx",
  // Russian / Slavic surnames
  "Volkov","Petrov","Sokolov","Ivanov","Romanov","Smirnov","Lebedev","Fedorov","Karpov","Sidorov",
  // Indian / South Asian surnames
  "Patel","Singh","Sharma","Reddy","Verma","Khan","Mehta","Nair","Iyer","Chowdhury",
  // Middle Eastern surnames
  "Al-Rashid","Al-Jabbar","Hakim","Khoury","Saleh","Mansour","Nasser",
  // Hawaiian / Pacific surnames
  "Kahuna","Kahale","Mahuta","Nainoa","Kona","Pukui","Kaleo",
  // Greek mythology / classics
  "Atlas","Apollo","Achilles","Ajax","Hercules","Argo","Stavros","Papadopoulos","Kostas","Alexandrou",
  // Roman / Latin
  "Caesar","Augustus","Aurelius","Maximus","Cato","Trajan","Octavian","Cicero","Crassus","Vespasian",
  // Egyptian mythology / pharaonic
  "Ra","Anubis","Horus","Osiris","Sobek","Khepri","Set","Hathor","Ramses","Khufu",
  "Imhotep","Ptolemy","Akhenaten","Thutmose","Senusret",
  // Norse mythology
  "Odinson","Thorson","Lokison","Bjornsson","Eriksson","Magnusson","Olafson",
  // Game of Thrones — house names
  "Stark","Lannister","Targaryen","Baratheon","Greyjoy","Tully","Tyrell","Martell","Arryn","Bolton",
  "Frey","Mormont","Tarly","Tarth","Clegane","Snow","Stone","Sand","Karstark","Umber",
  // Star Wars
  "Skywalker","Solo","Kenobi","Calrissian","Tarkin","Antilles","Fett","Windu","Andor","Wren",
  "Erso","Bridger","Kestis",
  // Lord of the Rings
  "Baggins","Took","Brandybuck","Gamgee","Greenleaf","Greybeard","Hornblower","Stormcrow",
  // Marvel / DC heroes (surnames that work)
  "Stark","Rogers","Banner","Parker","Kent","Wayne","Allen","Garrick","Howlett","Lehnsherr",
  // Breaking Bad / pop crime
  "White","Pinkman","Goodman",
  // Anime
  "Uchiha","Uzumaki","Hatake","Saiyan",
  // Doctor Who
  "Tyler","Smith","Pond",
];

// Creative-style first-name generator — produces things like D'Apple,
// Ja'Marquis, La'Vontay, Tre'Veon, Ke'Sean. Real NFL has tons of these.
const CREATIVE_PREFIXES = ["D'","Ja'","La'","Tre'","Ke'","Da'","De'","Quan'","Te'","Sha'"];
const CREATIVE_ROOTS = [
  "Andre","Marcus","Vontay","Quan","Sean","Marquis","Veon","Maine","Brick","Wayne",
  "Onta","Cobra","Apple","Cherry","Maple","Lemon","Mercedes","Cadillac","Stone","Crowne",
  "Pomelo","Pommel","Veius","Real","Wing","Vine","Vio","Drai","Mahn","Trell","Cion","Reon",
  "Vante","Saun","Shawn","Lonzo","Vontre","Andre","Jhon","Quez","Quavious",
];
function pickFirstName() {
  // 18% chance to roll a creative-style name, otherwise pull from the pool
  if (Math.random() < 0.18) {
    return CREATIVE_PREFIXES[Math.floor(Math.random() * CREATIVE_PREFIXES.length)]
         + CREATIVE_ROOTS[Math.floor(Math.random() * CREATIVE_ROOTS.length)];
  }
  return FIRST[Math.floor(Math.random() * FIRST.length)];
}

// pickLastName() pulls from the pool, with a ~9% chance of producing a
// hyphenated double-barrel surname (e.g., García-Schmidt, Tanaka-O'Brien).
function pickLastName() {
  const a = LAST[Math.floor(Math.random() * LAST.length)];
  if (Math.random() < 0.09) {
    let b = LAST[Math.floor(Math.random() * LAST.length)];
    // Avoid identical halves
    let guard = 0;
    while (b === a && guard++ < 4) b = LAST[Math.floor(Math.random() * LAST.length)];
    // Apostrophe-prefix surnames (O'Brien) don't combine cleanly into a hyphen
    if (b.includes("'") || a.includes("'")) return a;
    return `${a}-${b}`;
  }
  return a;
}

// ── Earned nicknames — only league-wide top 10 in their position get one,
// and the nickname is chosen based on WHAT THEY'RE KNOWN FOR (their dominant
// stat). Truck-stick RBs get Samson/Goliath; speed RBs get Asahel/Gabriel;
// shutdown CBs get Argus/Seraph; sack-demon DLs get Baal/Belial; etc.
// Greatly expanded nickname categories — cross-cultural mythology so we have
// enough unique nicknames to cover 80+ league-top players without duplicates.
const NICK_POWER   = ["Samson","Goliath","Behemoth","Og","Nimrod","Hercules","Atlas","Maximus","Titan","Colossus","Spartan","Antaeus","Talos","Bjorn","Surt","Ymir","Beowulf","Cuchulainn","Grendel"];
const NICK_SWIFT   = ["Asahel","Gabriel","Camael","Mercury","Hermes","Apollo","Eolus","Zephyr","Boreas","Quetzal","Sleipnir","Garuda"];
const NICK_TRICK   = ["Jacob","Esau","Reynard","Loki","Coyote","Anansi","Kitsune","Tezcat","Hermes","Puck","Mab"];
const NICK_SAGE    = ["Methuselah","Solomon","Daniel","Isaiah","Job","Ezekiel","Nestor","Plato","Socrates","Cicero","Confucius","Lao","Vyasa","Imhotep"];
const NICK_DEMON   = ["Baal","Belial","Asmodeus","Leviathan","Moloch","Abaddon","Azazel","Lilith","Beelzebub","Mammon","Shaitan","Astaroth","Bael","Mephistopheles","Pazuzu","Set","Apep","Surtur","Fenrir","Jormungandr","Hel","Cthulhu","Dagon","Tiamat","Vritra","Rakshasa","Kali"];
const NICK_HEAVENLY= ["Gabriel","Michael","Raphael","Uriel","Metatron","Sandalphon","Camael","Zadkiel","Israfil","Cassiel","Jophiel","Chamuel","Ariel","Ramiel","Selaphiel"];
const NICK_WATCH   = ["Argus","Seraph","Cherub","Watcher","Heimdall","Sentinel","Hawkeye","Vidar","Lynx","Mim","Ekek","Janus"];
const NICK_KING    = ["David","Solomon","Saul","Cyrus","Augustus","Caesar","Aurelius","Hadrian","Charlemagne","Tamerlane","Arthur","Pharaoh","Kang","Mansa"];
const NICK_WARRIOR = ["Joshua","Caleb","Gideon","Achilles","Hector","Ajax","Leonidas","Perseus","Theseus","Hannibal","Spartacus","Roland","El Cid","Bushido","Musashi","Saladin","Shaka"];
const NICK_HUNTER  = ["Nimrod","Orion","Skadi","Diana","Artemis","Mara","Tlaloc"];
const NICK_HANDS   = ["Methuselah","Solomon","Boaz","Job","Ezekiel","Daniel","Plato"];
const NICK_DOMINATOR=["Hercules","Maximus","Titan","Colossus","Talos","Megalos","Goliath","Cyclops"];

// Pull a nickname from a pool, filtering out any in `taken`. Returns null
// only if the pool is fully exhausted (callers fall through to other pools).
function pickFromPool(pool, taken) {
  if (!taken) return pool[Math.floor(Math.random() * pool.length)];
  const available = pool.filter(n => !taken.has(n));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function pickCareerNickname(player, taken = null) {
  if (!player) return null;
  const [spd, str, agi, awr, thr, cat, blk, prs, cov, tck, kpw] = player.stats;
  const pos = player.position;
  // Position-specific "expected mean" — biggest delta above this is the
  // player's dominant trait.
  const meanByPos = {
    QB: { thr: 78, awr: 78, spd: 72, agi: 72 },
    RB: { spd: 80, str: 76, agi: 78, cat: 70 },
    WR: { spd: 82, agi: 80, cat: 78, awr: 76 },
    TE: { cat: 76, str: 80, blk: 76, spd: 74 },
    OL: { str: 82, blk: 82, agi: 70, awr: 76 },
    DL: { str: 82, prs: 76, spd: 72, tck: 76 },
    LB: { tck: 80, cov: 74, prs: 74, spd: 76 },
    CB: { cov: 82, spd: 82, agi: 80, awr: 76 },
    S:  { cov: 80, spd: 78, tck: 78, awr: 78 },
  };
  const m = meanByPos[pos] || {};
  const statMap = { spd, str, agi, awr, thr, cat, blk, prs, cov, tck };
  let dominant = null, dominantDelta = -Infinity;
  for (const k of Object.keys(m)) {
    const delta = (statMap[k] - m[k]);
    if (delta > dominantDelta) { dominantDelta = delta; dominant = k; }
  }
  // Build a list of pools in priority order for this (pos, dominant) combo.
  // We try the first; if exhausted, fall through to the next, etc.
  let pools = [];
  if (pos === "RB") {
    if (dominant === "str")      pools = [NICK_POWER, NICK_DOMINATOR, NICK_WARRIOR];
    else if (dominant === "spd") pools = [NICK_SWIFT, NICK_HEAVENLY, NICK_WARRIOR];
    else if (dominant === "agi") pools = [NICK_TRICK, NICK_HUNTER, NICK_WARRIOR];
    else if (dominant === "cat") pools = [NICK_HANDS, NICK_SAGE];
    else                          pools = [NICK_WARRIOR, NICK_KING];
  } else if (pos === "WR") {
    if (dominant === "spd")      pools = [NICK_SWIFT, NICK_HEAVENLY];
    else if (dominant === "cat") pools = [NICK_HANDS, NICK_SAGE];
    else if (dominant === "agi") pools = [NICK_TRICK, NICK_SAGE];
    else if (dominant === "awr") pools = [NICK_SAGE, NICK_HEAVENLY];
    else                          pools = [NICK_HEAVENLY, NICK_SWIFT];
  } else if (pos === "QB") {
    if (dominant === "thr")      pools = [NICK_DOMINATOR, NICK_POWER, NICK_KING];
    else if (dominant === "awr") pools = [NICK_SAGE, NICK_KING];
    else if (dominant === "spd") pools = [NICK_WARRIOR, NICK_KING];
    else if (dominant === "agi") pools = [NICK_WARRIOR, NICK_TRICK];
    else                          pools = [NICK_KING, NICK_SAGE];
  } else if (pos === "DL") {
    if (dominant === "prs")      pools = [NICK_DEMON];
    else if (dominant === "str") pools = [NICK_POWER, NICK_DEMON, NICK_DOMINATOR];
    else if (dominant === "spd") pools = [NICK_DEMON, NICK_SWIFT];
    else                          pools = [NICK_DEMON, NICK_POWER];
  } else if (pos === "LB") {
    if (dominant === "tck")      pools = [NICK_POWER, NICK_DOMINATOR, NICK_DEMON];
    else if (dominant === "cov") pools = [NICK_HEAVENLY, NICK_WATCH];
    else if (dominant === "prs") pools = [NICK_DEMON];
    else if (dominant === "spd") pools = [NICK_SWIFT, NICK_HEAVENLY];
    else                          pools = [NICK_WARRIOR, NICK_HEAVENLY];
  } else if (pos === "CB") {
    if (dominant === "cov")      pools = [NICK_WATCH, NICK_HEAVENLY];
    else if (dominant === "spd") pools = [NICK_SWIFT, NICK_HEAVENLY];
    else if (dominant === "agi") pools = [NICK_TRICK, NICK_WATCH];
    else if (dominant === "awr") pools = [NICK_SAGE, NICK_WATCH];
    else                          pools = [NICK_WATCH, NICK_HEAVENLY];
  } else if (pos === "S") {
    if (dominant === "tck")      pools = [NICK_POWER, NICK_DEMON];
    else if (dominant === "cov") pools = [NICK_WATCH, NICK_HEAVENLY];
    else if (dominant === "awr") pools = [NICK_SAGE, NICK_WATCH];
    else                          pools = [NICK_WATCH, NICK_HEAVENLY];
  } else if (pos === "TE") {
    if (dominant === "blk")      pools = [NICK_POWER, NICK_DOMINATOR];
    else if (dominant === "cat") pools = [NICK_HANDS, NICK_SAGE];
    else                          pools = [NICK_WARRIOR, NICK_POWER];
  } else {
    pools = [NICK_WARRIOR];
  }
  // Try each pool in order; last-ditch fallback is a number suffix on a random
  // power name so we always return something unique.
  for (const pool of pools) {
    const pick = pickFromPool(pool, taken);
    if (pick) return pick;
  }
  // Truly exhausted (shouldn't happen given pool sizes) — suffix fallback
  for (let n = 2; n < 99; n++) {
    const base = NICK_POWER[Math.floor(Math.random() * NICK_POWER.length)];
    const suffixed = `${base} ${n === 2 ? "II" : n === 3 ? "III" : "IV"}`;
    if (!taken || !taken.has(suffixed)) return suffixed;
  }
  return null;
}

// Assign career nicknames to the league's top 10 per position by overall.
// Position-specific top-N: top 10 QBs, RBs, WRs (separate), TEs, etc. Once
// assigned, a nickname persists on the player object — it doesn't get
// overwritten if the player drops out of the top 10 next time.
function assignLeagueNicknames(rosters) {
  const allPlayers = [];
  for (const teamId of Object.keys(rosters)) {
    for (const p of rosters[teamId]) allPlayers.push(p);
  }
  // Resolve duplicate college-earned nicknames first — keep the first
  // occurrence, clear the rest so they get a fresh pick later.
  const seen = new Map();
  for (const p of allPlayers) {
    if (!p.nickname) continue;
    if (seen.has(p.nickname)) {
      p.nickname = null;
      p.collegeNickname = false;
    } else {
      seen.set(p.nickname, p);
    }
  }
  // Global "taken" set — no two players will share a nickname league-wide
  const taken = new Set(seen.keys());
  const positions = ["QB","RB","WR","TE","DL","LB","CB","S"];
  for (const pos of positions) {
    const top10 = allPlayers
      .filter(p => p.position === pos)
      .sort((a, b) => (b.overall || 0) - (a.overall || 0))
      .slice(0, 10);
    for (const p of top10) {
      if (p.nickname) continue;
      const nick = pickCareerNickname(p, taken);
      if (!nick) continue;
      p.nickname = nick;
      taken.add(nick);
      // GOES BY NICKNAME ONLY (~13%) — Madonna / Pelé / Ronaldinho style.
      // Player's display name becomes just the nickname, and their legal name
      // components are wiped (no firstName/middleName/lastName).
      if (Math.random() < 0.13) {
        p.goesByNicknameOnly = true;
        p.name = nick;
        p.firstName = nick;
        p.middleName = null;
        p.lastName = null;
      }
    }
  }
}

const ROSTER_SLOTS = { QB:3, RB:4, WR:6, TE:3, OL:8, DL:6, LB:5, CB:5, S:3, K:1, P:1 };

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const randf = (a, b) => Math.random() * (b - a) + a;
const randName = () => `${pickFirstName()} ${pickLastName()}`;

function statsFor(pos, tier) {
  const r = { elite:{lo:78,hi:99}, good:{lo:63,hi:80}, average:{lo:48,hi:67}, poor:{lo:35,hi:54} }[tier];
  const b = () => rand(r.lo, r.hi);
  // Lesser stats — secondary attributes below the primary range.
  // Floor kept at r.lo so secondary stats never go absurdly low, but
  // always stay below the primary ceiling so they can't inflate OVR.
  const l = () => rand(Math.max(r.lo, 30), Math.max(r.hi - 10, r.lo + 5));
  let stats;
  switch (pos) {
    case "QB": stats = [l(),l(),b(),b(),b(),l(),l(),l(),l(),l(),l()]; break;
    case "RB": stats = [b(),b(),b(),b(),l(),b(),l(),l(),l(),l(),l()]; break;
    case "WR": stats = [b(),l(),b(),b(),l(),b(),l(),l(),b(),l(),l()]; break;
    case "TE": stats = [b(),b(),b(),b(),l(),b(),b(),l(),l(),l(),l()]; break;
    case "OL": stats = [l(),b(),b(),b(),l(),l(),b(),l(),l(),l(),l()]; break;
    case "DL": stats = [b(),b(),b(),b(),l(),l(),l(),b(),l(),b(),l()]; break;
    case "LB": stats = [b(),b(),b(),b(),l(),l(),l(),b(),b(),b(),l()]; break;
    case "CB": stats = [b(),l(),b(),b(),l(),l(),l(),l(),b(),b(),l()]; break;
    case "S":  stats = [b(),b(),b(),b(),l(),l(),l(),l(),b(),b(),l()]; break;
    default:   stats = [l(),l(),l(),b(),l(),l(),l(),l(),l(),l(),b()];
  }
  // Signature stat — every player has at least one calling card. Picks a
  // random stat and ensures it lands in the 70-85 range so even "poor" tier
  // guys can be "the guy with the strong arm" or "the speedster off the bench."
  // Signature stat: every player has a calling card, but the ceiling
  // scales with tier so poor-tier UDFAs don't land near starter range.
  const sigCount = (tier === "poor" || tier === "average") ? 2 : 1;
  const sigMin = tier === "elite" ? 82 : tier === "good" ? 74 : tier === "average" ? 66 : 58;
  const sigMax = tier === "elite" ? 95 : tier === "good" ? 84 : tier === "average" ? 76 : 68;
  for (let i = 0; i < sigCount; i++) {
    const idx = rand(0, stats.length - 1);
    const sigVal = rand(sigMin, sigMax);
    if (stats[idx] < sigVal) stats[idx] = sigVal;
  }
  return stats;
}

// Flavor for bad players — they're never UNIFORMLY bad. They're either
// freak athletes with no football brain, or cerebral types with limited
// physical tools. Adds personality + makes scouting actually matter.
const PLAYER_FLAVORS = {
  RAW_ATHLETE:   { label: "Raw athlete",   blurb: "Elite tools, raw instincts" },
  HIGH_FOOTBALL_IQ: { label: "High football IQ", blurb: "Smart, schematic — physically limited" },
};
function applyFlavor(stats, pos) {
  // Returns the flavor key (or null) and mutates stats in place
  const r = Math.random();
  // Indices: 0=SPD, 1=STR, 2=AGI, 3=AWR, 4=THR, 5=CAT, 6=BLK, 7=PRS, 8=COV, 9=TCK, 10=KPW
  if (r < 0.45) {
    // RAW_ATHLETE: pump physical, sink AWR (and THR for QB).
    // Caps at solid-starter range (not elite) so poor-tier players
    // with raw athleticism don't end up with elite OVRs.
    stats[0] = Math.max(stats[0], rand(68, 80));   // SPD
    stats[1] = Math.max(stats[1], rand(65, 78));   // STR
    stats[2] = Math.max(stats[2], rand(68, 80));   // AGI
    stats[3] = Math.min(stats[3], rand(35, 50));   // AWR (poor instincts)
    if (pos === "QB") stats[4] = Math.min(stats[4], rand(45, 60));  // THR limited
    if (pos === "WR" || pos === "TE") stats[5] = Math.min(stats[5], rand(45, 60));  // bad hands
    if (pos === "CB" || pos === "S") stats[8] = Math.min(stats[8], rand(45, 58));   // bad coverage
    return "RAW_ATHLETE";
  } else if (r < 0.90) {
    // HIGH_FOOTBALL_IQ: pump AWR (+ pos-specific skill), sink physical
    stats[3] = Math.max(stats[3], rand(78, 92));   // AWR
    stats[0] = Math.min(stats[0], rand(42, 55));   // SPD
    stats[1] = Math.min(stats[1], rand(45, 58));   // STR
    stats[2] = Math.min(stats[2], rand(45, 58));   // AGI
    if (pos === "QB") stats[4] = Math.max(stats[4], rand(75, 88));  // good throws (accuracy)
    if (pos === "WR" || pos === "TE") stats[5] = Math.max(stats[5], rand(78, 92));  // great hands
    if (pos === "CB" || pos === "S" || pos === "LB") stats[8] = Math.max(stats[8], rand(75, 90));  // coverage smarts
    if (pos === "OL") stats[6] = Math.max(stats[6], rand(78, 92));  // technician blocker
    if (pos === "DL" || pos === "LB") stats[7] = Math.max(stats[7], rand(75, 88));  // pass-rush technique
    return "HIGH_FOOTBALL_IQ";
  }
  return null;
}
function calcOverall(pos, s) {
  const [spd,str,agi,awr,thr,cat,blk,prs,cov,tck,kpw] = s;
  let v;
  switch (pos) {
    case "QB": v = spd*10+agi*15+awr*25+thr*50; break;
    case "RB": v = spd*35+str*20+agi*25+cat*20; break;
    case "WR": v = spd*30+agi*25+cat*35+awr*10; break;
    case "TE": v = spd*20+cat*40+blk*30+str*10; break;
    case "OL": v = str*35+blk*45+agi*20;        break;
    case "DL": v = str*35+prs*40+spd*25;        break;
    case "LB": v = prs*25+cov*25+tck*30+spd*20; break;
    case "CB": v = spd*30+agi*25+cov*35+awr*10; break;
    case "S":  v = spd*25+cov*35+tck*30+awr*10; break;
    default:   v = kpw*50+awr*50;
  }
  return Math.min(99, Math.max(40, Math.round(v / 100)));
}
// ─── Trench archetypes & rock-paper-scissors matchup matrix ─────────────
// Each DL has a fighting style with signature pass-rush moves. Each OL has
// a build that handles certain styles well and others poorly. Matchup table
// returns a multiplier on this rep's pressure / sack chance.
const DL_ARCHETYPES = {
  POWER:      { label: "Power",        blurb: "Bull rusher — drives O-line back",          moves: ["BULL RUSH", "CLUB-RIP", "LONG ARM"] },
  SPEED:      { label: "Speed",        blurb: "Edge bender — wins with first step",        moves: ["SPEED RUSH", "DIP-AND-RIP", "GHOST"] },
  TWEENER:    { label: "Tweener",      blurb: "Undersized — beats power w/ tech + speed",  moves: ["SWIM", "SPIN", "CROSS CHOP"] },
  PENETRATOR: { label: "Penetrator",   blurb: "Explosive 3-tech — blows up the pocket",    moves: ["PIERCE", "STAB", "GET-OFF"] },
  TECHNICIAN: { label: "Technician",   blurb: "Hand-fighter — wins reps with footwork",    moves: ["HAND FIGHT", "COUNTER", "ARM-OVER"] },
};
const DL_ARCHETYPE_KEYS = Object.keys(DL_ARCHETYPES);
const OL_ARCHETYPES = {
  ANCHOR:     { label: "Anchor",       blurb: "Stout, immovable — eats bull rushes" },
  ATHLETIC:   { label: "Athletic",     blurb: "Quick feet, mirrors speed rushers" },
  TECHNICIAN: { label: "Technician",   blurb: "Disciplined hands, wins the leverage battle" },
  PLUG:       { label: "Plug",         blurb: "Short + squat, low base, hard to swim over" },
  MAULER:     { label: "Mauler",       blurb: "Road grader — destroys in the run game" },
};
const OL_ARCHETYPE_KEYS = Object.keys(OL_ARCHETYPES);

// Pass-rush multiplier — values >1 favor the rusher, <1 favor the blocker.
const PASS_MATCHUP = {
  POWER:      { ANCHOR: 0.70, ATHLETIC: 1.32, TECHNICIAN: 1.05, PLUG: 0.90, MAULER: 1.15 },
  SPEED:      { ANCHOR: 1.30, ATHLETIC: 0.68, TECHNICIAN: 1.00, PLUG: 1.12, MAULER: 1.28 },
  TWEENER:    { ANCHOR: 1.18, ATHLETIC: 1.08, TECHNICIAN: 0.72, PLUG: 1.05, MAULER: 1.30 },
  PENETRATOR: { ANCHOR: 1.10, ATHLETIC: 0.78, TECHNICIAN: 0.95, PLUG: 1.28, MAULER: 1.05 },
  TECHNICIAN: { ANCHOR: 0.82, ATHLETIC: 1.05, TECHNICIAN: 1.12, PLUG: 1.05, MAULER: 1.28 },
};
// Run-blocking multiplier — values >1 favor offense (better gap), <1 favor defense (stuffed).
const RUN_MATCHUP = {
  POWER:      { ANCHOR: 0.95, ATHLETIC: 1.10, TECHNICIAN: 1.05, PLUG: 0.80, MAULER: 1.15 },
  SPEED:      { ANCHOR: 1.20, ATHLETIC: 1.05, TECHNICIAN: 1.05, PLUG: 1.10, MAULER: 1.20 },
  TWEENER:    { ANCHOR: 1.15, ATHLETIC: 1.10, TECHNICIAN: 0.95, PLUG: 1.05, MAULER: 1.20 },
  PENETRATOR: { ANCHOR: 1.05, ATHLETIC: 1.10, TECHNICIAN: 0.95, PLUG: 0.75, MAULER: 1.00 },
  TECHNICIAN: { ANCHOR: 1.05, ATHLETIC: 1.10, TECHNICIAN: 1.05, PLUG: 0.95, MAULER: 1.18 },
};

function pickDLArchetype(stats) {
  // Bias archetype by stats: high speed → SPEED, high strength → POWER, etc.
  const [spd, str, agi, awr, _thr, _cat, _blk, prs] = stats;
  const weights = {
    POWER:      Math.max(0, str - 60) + Math.max(0, prs - 65) * 0.5,
    SPEED:      Math.max(0, spd - 55) * 1.2 + Math.max(0, agi - 55) * 0.5,
    TWEENER:    Math.max(0, (spd + agi) / 2 - 50) + (str < 75 ? 8 : 0),
    PENETRATOR: Math.max(0, spd - 60) + Math.max(0, prs - 60),
    TECHNICIAN: Math.max(0, awr - 60) * 1.4 + Math.max(0, agi - 55) * 0.5,
  };
  // Add noise so it's not too deterministic
  for (const k in weights) weights[k] += Math.random() * 8;
  return Object.keys(weights).reduce((a, b) => weights[a] >= weights[b] ? a : b);
}
function pickOLArchetype(stats) {
  const [spd, str, agi, awr, _thr, _cat, blk] = stats;
  const weights = {
    ANCHOR:     Math.max(0, str - 55) * 1.4 + (spd < 60 ? 6 : 0),
    ATHLETIC:   Math.max(0, spd - 50) * 1.5 + Math.max(0, agi - 55) * 0.8,
    TECHNICIAN: Math.max(0, awr - 55) * 1.5 + Math.max(0, blk - 60) * 0.8,
    PLUG:       (str > 60 && spd < 60 ? 12 : 4),
    MAULER:     Math.max(0, str - 60) + Math.max(0, blk - 60) * 1.3,
  };
  for (const k in weights) weights[k] += Math.random() * 7;
  return Object.keys(weights).reduce((a, b) => weights[a] >= weights[b] ? a : b);
}

// ─── Skill-position archetypes ─────────────────────────────────────────
const QB_ARCHETYPES = {
  POCKET:      { label: "Pocket Passer", blurb: "Classic dropback — accurate, immobile" },
  GUNSLINGER:  { label: "Gunslinger",    blurb: "Big arm, high risk — chunk plays + INTs" },
  GAME_MANAGER:{ label: "Game Manager",  blurb: "Efficient short throws — protects the ball" },
  DUAL_THREAT: { label: "Dual Threat",   blurb: "Mobile — scrambles when pressured" },
  FIELD_GENERAL:{label: "Field General", blurb: "Smart play-caller — balanced, low INTs" },
};
function pickQBArchetype(stats) {
  const [spd, _str, agi, awr, thr] = stats;
  const w = {
    POCKET:        Math.max(0, thr - 65) * 1.3 + (spd < 65 ? 5 : 0),
    GUNSLINGER:    Math.max(0, thr - 70) * 1.5 + (awr < 75 ? 5 : 0),
    GAME_MANAGER:  Math.max(0, awr - 65) * 1.3 + (thr < 80 ? 4 : 0),
    DUAL_THREAT:   Math.max(0, spd - 65) * 1.5 + Math.max(0, agi - 60) * 0.5,
    FIELD_GENERAL: Math.max(0, awr - 70) * 1.5,
  };
  for (const k in w) w[k] += Math.random() * 6;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}

// Stat profile per QB archetype — offsets from the target overall.
// Tuned so that the weighted average (0.1*SPD + 0.15*AGI + 0.25*AWR + 0.5*THR)
// of the offsets ≈ 0, then we solve for THR exactly to nail the target OVR.
const QB_ARCH_PROFILES = {
  POCKET:       { spd: -28, agi: -18, awr: +2,  thr: +12, blurb: "Statue with a cannon" },
  GUNSLINGER:   { spd: -12, agi: -10, awr: -12, thr: +14, blurb: "Big arm, low awareness" },
  GAME_MANAGER: { spd: -18, agi: -10, awr: +14, thr: -4,  blurb: "Smart, weaker arm" },
  DUAL_THREAT:  { spd: +12, agi: +14, awr: -6,  thr: -6,  blurb: "Mobile, average arm" },
  FIELD_GENERAL:{ spd: -12, agi: -6,  awr: +14, thr: +4,  blurb: "Smart and accurate" },
};
function genTestQB(arch, targetOvr) {
  const prof = QB_ARCH_PROFILES[arch];
  const jit = () => rand(-2, 2);
  const clamp = (v) => Math.min(99, Math.max(35, Math.round(v)));
  const spd = clamp(targetOvr + prof.spd + jit());
  const agi = clamp(targetOvr + prof.agi + jit());
  const awr = clamp(targetOvr + prof.awr + jit());
  // Solve THR so weighted overall == target: 0.1*spd + 0.15*agi + 0.25*awr + 0.5*thr = target
  const thr = clamp((targetOvr - 0.1*spd - 0.15*agi - 0.25*awr) / 0.5);
  const str = clamp(targetOvr - 25 + jit());
  // Non-overall stats: middling filler
  const filler = () => rand(45, 60);
  const stats = [spd, str, agi, awr, thr, filler(), filler(), filler(), filler(), filler(), filler()];
  return {
    name: `${QB_ARCHETYPES[arch].label} (Test)`,
    position: "QB",
    age: 27,
    stats,
    overall: calcOverall("QB", stats),
    archetype: arch,
  };
}

const RB_ARCHETYPES = {
  POWER:     { label: "Power Back",  blurb: "Bruiser — breaks tackles, more fumbles, shorter career" },
  ELUSIVE:   { label: "Elusive",     blurb: "Jukes and spins — high YAC, durable" },
  SPEED:     { label: "Speed Back",  blurb: "Home-run hitter — chunk plays but boom/bust" },
  WORKHORSE: { label: "Workhorse",   blurb: "Every-down back — balanced, durable" },
  RECEIVING: { label: "3rd-Down RB", blurb: "Pass-catching specialist — dump-offs and screens" },
};
const WR_ARCHETYPES = {
  DEEP_THREAT: { label: "Deep Threat", blurb: "Speed receiver — big plays but lower catch%" },
  POSSESSION:  { label: "Possession",  blurb: "Reliable hands — short routes, high catch%" },
  SLOT:        { label: "Slot",        blurb: "Quick, shifty — YAC monster on quick game" },
  RED_ZONE:    { label: "Red Zone",    blurb: "Big-bodied — jump-ball winner, low YAC" },
  ROUTE_RUNNER:{ label: "Route Runner",blurb: "Technician — gets open against tight coverage" },
};
const TE_ARCHETYPES = {
  RECEIVING: { label: "Receiving TE", blurb: "Like a big WR — weak blocker" },
  BLOCKING:  { label: "Blocking TE",  blurb: "Sixth lineman — boosts run game, rare target" },
  HYBRID:    { label: "Hybrid",       blurb: "Balanced — does a bit of both" },
};
const LB_ARCHETYPES = {
  THUMPER:  { label: "Thumper",   blurb: "Run-stopper — heavy hitter, weak in coverage" },
  COVER:    { label: "Cover LB",  blurb: "Sideline-to-sideline — drops into pass coverage" },
  BLITZER:  { label: "Blitzer",   blurb: "Pass rusher — gets after the QB" },
  SIGNAL:   { label: "Signal-caller", blurb: "Smart anchor — calls plays, balanced" },
  HYBRID:   { label: "Hybrid",    blurb: "Three-down LB — tackles + coverage" },
};
const CB_ARCHETYPES = {
  SHUTDOWN: { label: "Shutdown",  blurb: "Locks down WRs — QBs avoid him" },
  BALL_HAWK:{ label: "Ball Hawk", blurb: "Gambles — lots of INTs, also lots of give-ups" },
  PHYSICAL: { label: "Press",     blurb: "Jams at the line — disruptive, slower deep" },
  SLOT_CB:  { label: "Slot CB",   blurb: "Quick — covers slot WRs, blitzes" },
  ZONE:     { label: "Zone",      blurb: "Disciplined — fewer big plays allowed" },
};
const S_ARCHETYPES = {
  BALL_HAWK:    { label: "Ball Hawk",    blurb: "Range + nose for the ball — high INTs" },
  BOX:          { label: "Box Safety",   blurb: "Extra LB — tackle machine in the box" },
  CENTER_FIELD: { label: "Center Field", blurb: "Deep coverage — prevents big plays" },
  HYBRID:       { label: "Hybrid",       blurb: "Plays single-high or in the box equally well" },
};
// Kicker archetypes — affect FG accuracy, range, and kickoff distance.
const K_ARCHETYPES = {
  LEG:       { label: "Big Leg",   blurb: "Long-range threat — 60+ yd FGs in play, but a hair less accurate" },
  PRECISION: { label: "Precision", blurb: "Money inside 45 — fewer big-leg kicks but rarely shanks one" },
  CLUTCH:    { label: "Clutch",    blurb: "Comes through when it matters — better in 4th Q close games" },
  BALANCED:  { label: "Balanced",  blurb: "No real weakness — a steady veteran" },
};
// Punter archetypes — affect distance, hang time, and directional pinning.
const P_ARCHETYPES = {
  BOOMER:      { label: "Boomer",      blurb: "Crushes it — long average, but more touchbacks" },
  DIRECTIONAL: { label: "Directional", blurb: "Pinpoint coffin-corner — short but high fair-catch rate" },
  HANG_TIME:   { label: "Hang Time",   blurb: "Sky kicks — minimal return yards, average distance" },
  ATHLETE:     { label: "Athletic",    blurb: "Trick-play threat — can run or throw on fake punts" },
  BALANCED:    { label: "Balanced",    blurb: "Solid all-around — no weakness, no signature trait" },
};

function pickRBArchetype(stats) {
  const [spd, str, agi, awr, _thr, cat] = stats;
  const w = {
    POWER:     Math.max(0, str - 55) * 1.5 + (spd < 70 ? 4 : 0),
    ELUSIVE:   Math.max(0, agi - 60) * 1.4 + Math.max(0, awr - 55) * 0.5,
    SPEED:     Math.max(0, spd - 70) * 1.6 + (str < 70 ? 4 : 0),
    WORKHORSE: 6 + Math.max(0, awr - 60),
    RECEIVING: Math.max(0, cat - 60) * 1.6 + Math.max(0, agi - 55) * 0.5,
  };
  for (const k in w) w[k] += Math.random() * 6;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickWRArchetype(stats) {
  const [spd, str, agi, awr, _thr, cat] = stats;
  const w = {
    DEEP_THREAT:  Math.max(0, spd - 70) * 1.5,
    POSSESSION:   Math.max(0, cat - 65) * 1.4 + Math.max(0, awr - 60) * 0.6,
    SLOT:         Math.max(0, agi - 65) * 1.4 + Math.max(0, spd - 65) * 0.5,
    RED_ZONE:     Math.max(0, str - 55) * 1.6 + Math.max(0, cat - 55) * 0.5,
    ROUTE_RUNNER: Math.max(0, awr - 60) * 1.4 + Math.max(0, agi - 55) * 0.5,
  };
  for (const k in w) w[k] += Math.random() * 6;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickTEArchetype(stats) {
  const [_spd, str, _agi, _awr, _thr, cat, blk] = stats;
  const w = {
    RECEIVING: Math.max(0, cat - 55) * 1.5,
    BLOCKING:  Math.max(0, blk - 55) * 1.4 + Math.max(0, str - 55) * 0.5,
    HYBRID:    8,
  };
  for (const k in w) w[k] += Math.random() * 5;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickLBArchetype(stats) {
  const [spd, str, _agi, awr, _thr, _cat, _blk, prs, cov, tck] = stats;
  const w = {
    THUMPER: Math.max(0, str - 55) * 1.3 + Math.max(0, tck - 60) * 0.7,
    COVER:   Math.max(0, cov - 55) * 1.4 + Math.max(0, spd - 60) * 0.6,
    BLITZER: Math.max(0, prs - 60) * 1.4 + Math.max(0, spd - 55) * 0.5,
    SIGNAL:  Math.max(0, awr - 60) * 1.4,
    HYBRID:  6,
  };
  for (const k in w) w[k] += Math.random() * 5;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickCBArchetype(stats) {
  const [spd, str, agi, awr, _thr, _cat, _blk, _prs, cov] = stats;
  const w = {
    SHUTDOWN: Math.max(0, cov - 65) * 1.5 + Math.max(0, spd - 65) * 0.5,
    BALL_HAWK:Math.max(0, awr - 55) * 1.3 + Math.max(0, agi - 60) * 0.6,
    PHYSICAL: Math.max(0, str - 50) * 1.6 + (spd < 75 ? 4 : 0),
    SLOT_CB:  Math.max(0, agi - 65) * 1.4 + Math.max(0, spd - 60) * 0.4,
    ZONE:     Math.max(0, awr - 60) * 1.4,
  };
  for (const k in w) w[k] += Math.random() * 6;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickSArchetype(stats) {
  const [spd, _str, _agi, awr, _thr, _cat, _blk, _prs, cov, tck] = stats;
  const w = {
    BALL_HAWK:    Math.max(0, awr - 60) * 1.4 + Math.max(0, cov - 60) * 0.5,
    BOX:          Math.max(0, tck - 60) * 1.5,
    CENTER_FIELD: Math.max(0, spd - 60) * 1.3 + Math.max(0, cov - 60) * 0.5,
    HYBRID:       8,
  };
  for (const k in w) w[k] += Math.random() * 5;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}

// K archetypes — KPW (kpw=stats[10]) drives leg, AWR (stats[3]) drives accuracy
function pickKArchetype(stats) {
  const awr = stats[3], kpw = stats[10] ?? 70;
  const w = {
    LEG:       Math.max(0, kpw - 70) * 1.6 + (awr < 70 ? 3 : 0),
    PRECISION: Math.max(0, awr - 70) * 1.5 + (kpw < 75 ? 3 : 0),
    CLUTCH:    Math.max(0, awr - 65) * 0.8 + Math.max(0, kpw - 65) * 0.5,
    BALANCED:  6 + Math.max(0, ((kpw + awr) / 2) - 65),
  };
  for (const k in w) w[k] += Math.random() * 4;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
// P archetypes — KPW = punt distance, AWR = directional / hang-time accuracy
function pickPArchetype(stats) {
  const spd = stats[0] ?? 60, agi = stats[2] ?? 60;
  const awr = stats[3], kpw = stats[10] ?? 70;
  const w = {
    BOOMER:      Math.max(0, kpw - 70) * 1.6 + (awr < 70 ? 2 : 0),
    DIRECTIONAL: Math.max(0, awr - 72) * 1.5 + (kpw < 72 ? 2 : 0),
    HANG_TIME:   Math.max(0, awr - 65) * 0.7 + Math.max(0, kpw - 60) * 0.6,
    ATHLETE:     Math.max(0, spd - 65) * 1.4 + Math.max(0, agi - 65) * 1.1 + Math.max(0, awr - 60) * 0.3,
    BALANCED:    6 + Math.max(0, ((kpw + awr) / 2) - 65),
  };
  for (const k in w) w[k] += Math.random() * 4;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}

// Pick a running style based on position + archetype — each player runs slightly differently.
// Detect rare strengths that don't fit a player's archetype. Pure flavor —
// stats stay as rolled, archetype label stays best-fit. The anomaly text is
// surfaced in the tooltip as e.g. "Thumper who can cover" or "Shutdown corner
// with hands". Returns an array of short strings (most players have 0-1).
function findArchetypeAnomalies(player) {
  const out = [];
  const s = player.stats;
  const SPD = s[0], STR = s[1], AGI = s[2], AWR = s[3];
  const CAT = s[5], PRS = s[7], COV = s[8], TCK = s[9];
  const arch = player.archetype;
  const pos = player.position;
  const ELITE = 88;     // threshold for "anomalous strength"
  const ELITE2 = 92;    // headline anomaly
  if (pos === "LB") {
    if (arch === "THUMPER" && COV >= ELITE)   out.push("Thumper who can cover");
    if (arch === "THUMPER" && SPD >= ELITE)   out.push("Sideline-to-sideline thumper");
    if (arch === "BLITZER" && COV >= ELITE)   out.push("Blitzer with coverage chops");
    if (arch === "COVER"   && STR >= ELITE)   out.push("Coverage LB who packs a punch");
    if (arch === "SIGNAL"  && PRS >= ELITE)   out.push("Signal-caller with sneaky pass-rush juice");
    if (arch === "HYBRID"  && AWR >= ELITE2)  out.push("Hybrid with rare instincts");
  }
  if (pos === "CB") {
    if (arch === "PHYSICAL" && SPD >= ELITE)  out.push("Physical corner who can flat-out RUN");
    if (arch === "SHUTDOWN" && STR >= ELITE)  out.push("Shutdown corner who'll lay you out");
    if (arch === "SLOT_CB"  && STR >= ELITE)  out.push("Slot corner who's not afraid of contact");
    if (arch === "ZONE"     && AGI >= ELITE)  out.push("Zone corner with man-cover quicks");
    if (arch === "BALL_HAWK"&& COV >= ELITE2) out.push("Ball hawk who locks down too");
  }
  if (pos === "S") {
    if (arch === "BOX"          && COV >= ELITE)  out.push("Box safety who covers like a corner");
    if (arch === "CENTER_FIELD" && STR >= ELITE)  out.push("Center fielder who'll bring the wood");
    if (arch === "BALL_HAWK"    && TCK >= ELITE)  out.push("Ball hawk who tackles in the box");
    if (arch === "HYBRID"       && SPD >= ELITE2) out.push("Hybrid safety with rare range");
  }
  if (pos === "DL") {
    if (arch === "POWER"      && SPD >= ELITE)  out.push("Power rusher with sneaky speed");
    if (arch === "SPEED"      && STR >= ELITE)  out.push("Speed rusher who can also bull");
    if (arch === "PENETRATOR" && COV >= 75)     out.push("Interior who drops into coverage");
    if (arch === "TECHNICIAN" && PRS >= ELITE2) out.push("Technician with elite pass-rush production");
  }
  if (pos === "OL") {
    if (arch === "MAULER"   && AGI >= ELITE) out.push("Mauler with light feet");
    if (arch === "ATHLETIC" && STR >= ELITE) out.push("Athletic OL who can also road-grade");
    if (arch === "PLUG"     && SPD >= 75)    out.push("Plug who pulls like a guard");
  }
  if (pos === "RB") {
    if (arch === "POWER"     && SPD >= ELITE) out.push("Power back with breakaway speed");
    if (arch === "ELUSIVE"   && STR >= ELITE) out.push("Elusive back who runs through tackles");
    if (arch === "WORKHORSE" && CAT >= ELITE) out.push("Workhorse who catches everything");
    if (arch === "RECEIVING" && STR >= ELITE) out.push("Receiving back who breaks tackles");
  }
  if (pos === "WR") {
    if (arch === "DEEP"        && CAT >= ELITE2) out.push("Deep threat with reliable hands");
    if (arch === "POSSESSION"  && SPD >= ELITE)  out.push("Possession WR with deep speed");
    if (arch === "ROUTE_RUNNER"&& STR >= ELITE)  out.push("Route runner with contested-catch frame");
    if (arch === "SLOT"        && STR >= ELITE)  out.push("Slot receiver with linebacker frame");
    if (arch === "RED_ZONE"    && SPD >= ELITE)  out.push("Red-zone WR who can take the top off");
  }
  if (pos === "TE") {
    if (arch === "BLOCKING"  && CAT >= ELITE2) out.push("Blocking TE with hands");
    if (arch === "RECEIVING" && STR >= ELITE)  out.push("Receiving TE who blocks the edge");
    if (arch === "SEAM"      && STR >= ELITE)  out.push("Seam TE who can in-line block");
  }
  if (pos === "QB") {
    if (arch === "POCKET"      && SPD >= ELITE)  out.push("Pocket passer with surprising legs");
    if (arch === "DUAL_THREAT" && AWR >= ELITE2) out.push("Dual-threat with field-general reads");
    if (arch === "GUNSLINGER"  && AWR >= ELITE)  out.push("Gunslinger with rare poise");
    if (arch === "GAME_MANAGER"&& s[4] >= ELITE2) out.push("Game manager with a cannon");
  }
  return out.length ? out : null;
}

function pickRunStyle(pos, archetype) {
  if (pos === "QB") return archetype === "DUAL_THREAT" ? "scrambler" : "smooth";
  if (pos === "RB") {
    if (archetype === "POWER")  return "powerful";
    if (archetype === "SPEED")  return "loping";
    if (archetype === "ELUSIVE")return "short";
    return "smooth";
  }
  if (pos === "WR") {
    if (archetype === "DEEP_THREAT") return "loping";
    if (archetype === "SLOT")        return "short";
    return "glider";
  }
  if (pos === "TE") return archetype === "BLOCKING" ? "plodding" : "powerful";
  if (pos === "OL") return "plodding";
  if (pos === "DL") {
    if (archetype === "SPEED")   return "loping";
    if (archetype === "POWER")   return "powerful";
    if (archetype === "TWEENER") return "short";
    return "plodding";
  }
  if (pos === "LB") return archetype === "THUMPER" ? "powerful" : "smooth";
  if (pos === "CB") {
    if (archetype === "SHUTDOWN") return "loping";
    if (archetype === "SLOT_CB")  return "short";
    return "smooth";
  }
  if (pos === "S")  return archetype === "CENTER_FIELD" ? "loping" : "smooth";
  return "smooth";
}
function pickCelebStyle() {
  return CELEB_STYLES[Math.floor(Math.random() * CELEB_STYLES.length)];
}

// Position-realistic height (inches) + weight (lbs). bodyType nudges the
// roll: PLUS_SIZE skews heavier, SLENDER skews lighter.
const HW_RANGES = {
  QB: { h: [74, 78], w: [210, 240] },
  RB: { h: [68, 73], w: [195, 235] },
  WR: { h: [70, 76], w: [180, 220] },
  TE: { h: [75, 79], w: [240, 265] },
  OL: { h: [75, 79], w: [295, 345] },
  DL: { h: [74, 79], w: [265, 320] },
  LB: { h: [72, 76], w: [225, 260] },
  CB: { h: [70, 74], w: [180, 200] },
  S:  { h: [71, 75], w: [195, 215] },
  K:  { h: [70, 75], w: [185, 215] },
  P:  { h: [72, 76], w: [195, 220] },
};
function assignHeightWeight(p) {
  const r = HW_RANGES[p.position] || HW_RANGES.WR;
  let height = r.h[0] + Math.floor(Math.random() * (r.h[1] - r.h[0] + 1));
  let weight = r.w[0] + Math.floor(Math.random() * (r.w[1] - r.w[0] + 1));
  if (p.bodyType === "PLUS_SIZE") { height += 1; weight += 18; }
  else if (p.bodyType === "SLENDER") { weight -= 10; }
  p.height = height;
  p.weight = weight;
}
function formatHeight(inches) {
  if (!inches) return "";
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}

function genPlayer(pos, tier) {
  const stats = statsFor(pos, tier);
  // Bad-tier players get a flavor: physical freak who can't read defenses,
  // or smart vet whose body is shot. Skip flavor for K/P/special teams.
  let flavor = null;
  if ((tier === "poor" || tier === "average") && pos !== "K" && pos !== "P") {
    flavor = applyFlavor(stats, pos);
  }
  // Build the legal name: first + (optional middle) + last. The display name
  // (what shows up in play logs, tooltips, and on the field) might be the
  // initials version ("T.J. Watt"), the middle name ("Cooper Smith"), or
  // just first+last, depending on how the player "goes by".
  const firstName = pickFirstName();
  const lastName  = pickLastName();
  const middleName = Math.random() < 0.55 ? pickFirstName() : null;
  let displayName = `${firstName} ${lastName}`;
  if (middleName && !middleName.includes("'") && !firstName.includes("'")
      && !middleName.includes("-") && !firstName.includes("-")) {
    const roll = Math.random();
    if (roll < 0.07) {
      // Initials style: "T.J. Watt" (real NFL: T.J. Watt, A.J. Brown, C.J. Stroud)
      displayName = `${firstName[0]}.${middleName[0]}. ${lastName}`;
    } else if (roll < 0.11) {
      // Goes by middle name: drops the first entirely
      displayName = `${middleName} ${lastName}`;
    } else if (roll < 0.13) {
      // First + middle initial: "Patrick L. Mahomes"
      displayName = `${firstName} ${middleName[0]}. ${lastName}`;
    }
  }
  const player = {
    pid: Math.random().toString(36).slice(2, 10),
    name: displayName,
    firstName, middleName, lastName,
    position: pos,
    age: rand(21, 33),
    stats,
    overall: calcOverall(pos, stats),
    flavor,
  };
  switch (pos) {
    case "QB": player.archetype = pickQBArchetype(stats); break;
    case "DL": player.archetype = pickDLArchetype(stats); break;
    case "OL": player.archetype = pickOLArchetype(stats); break;
    case "RB": player.archetype = pickRBArchetype(stats); break;
    case "WR": player.archetype = pickWRArchetype(stats); break;
    case "TE": player.archetype = pickTEArchetype(stats); break;
    case "LB": player.archetype = pickLBArchetype(stats); break;
    case "CB": player.archetype = pickCBArchetype(stats); break;
    case "S":  player.archetype = pickSArchetype(stats);  break;
    case "K":  player.archetype = pickKArchetype(stats);  break;
    case "P":  player.archetype = pickPArchetype(stats);  break;
  }
  // Tag any "anomaly" — a rare strength outside what the archetype typically
  // implies (e.g. a Thumper LB who can also cover). Surfaced in the tooltip
  // as a fun-fact. Doesn't change the stats; the archetype label is still the
  // best-fit summary.
  player.anomalies = findArchetypeAnomalies(player);
  player.runStyle = pickRunStyle(pos, player.archetype);
  player.celebStyle = pickCelebStyle();
  player.bodyType = pickBodyType(pos, player.archetype);
  player.nickname = null;
  // Height (inches) + weight (lbs) drawn from position-realistic ranges,
  // nudged by bodyType so PLUS_SIZE / SLENDER read on the profile.
  assignHeightWeight(player);
  // College jersey number — the digit they wore in college and would prefer
  // to keep. Final pro number assigned at the team level (see
  // assignTeamJerseyNumbers) which resolves conflicts.
  assignCollegeNumber(player);
  // COLLEGE NICKNAME — young (≤23), highly-rated players have a 30% chance of
  // arriving with a nickname earned in college (record-breakers, elite
  // prospects). They keep it through their career; pro top-10 status won't
  // overwrite it. Tagged player.collegeNickname=true so the tooltip can
  // surface "earned in college".
  if (player.age <= 23 && player.overall >= 86 && pos !== "K" && pos !== "P"
      && Math.random() < 0.30) {
    const nick = pickCareerNickname(player);
    if (nick) {
      player.nickname = nick;
      player.collegeNickname = true;
    }
  }
  // Mock the player's career (year-by-year stats + accolades) at gen time
  generateCareer(player);
  return player;
}

// ─── MOCK CAREER GENERATION ─────────────────────────────────────────────────
// Fabricates a believable multi-season career for each player based on their
// age + overall rating + position. Used to populate the profile-page hover.
function generateCareer(player) {
  if (!player || !player.position) return;
  const age = player.age || 24;
  const seasonsPlayed = Math.max(0, age - 22);
  if (seasonsPlayed === 0) {
    player.career = [];
    player.careerTotals = {};
    player.careerHistory = [];
    player.careerStats = {};
    player.proBowls = 0; player.allPros = 0; player.sbRings = 0;
    player.mvps = 0; player.opoys = 0; player.dpoys = 0; player.roys = 0;
    player.records = [];
    return;
  }
  const currentYear = 2026;
  const ovr = player.overall || 70;
  const pos = player.position;

  // ── Trajectory type ─────────────────────────────────────────────────────
  // Deterministic from name hash so career arc is stable across reloads.
  let nameHash = 0;
  for (const c of (player.name || "")) nameHash = (nameHash * 31 + c.charCodeAt(0)) | 0;
  const nh = Math.abs(nameHash);

  // Elite players skew toward early bloom / consistency.
  // Average players skew toward late bloom / streaky.
  let trajectory;
  if (ovr >= 88) {
    const t = nh % 10;
    trajectory = t < 4 ? "EARLY_BLOOM" : t < 7 ? "CONSISTENT" : t < 9 ? "LATE_BLOOM" : "STREAKY";
  } else if (ovr >= 78) {
    const t = nh % 10;
    trajectory = t < 2 ? "EARLY_BLOOM" : t < 5 ? "CONSISTENT" : t < 8 ? "LATE_BLOOM" : "STREAKY";
  } else if (ovr >= 68) {
    const t = nh % 10;
    trajectory = t < 1 ? "EARLY_BLOOM" : t < 3 ? "CONSISTENT" : t < 6 ? "LATE_BLOOM" : t < 9 ? "STREAKY" : "FLASH";
  } else {
    const t = nh % 10;
    trajectory = t < 2 ? "CONSISTENT" : t < 5 ? "LATE_BLOOM" : t < 8 ? "STREAKY" : "FLASH";
  }

  // Peak age and shape params.
  // rampYears: seasons from age-22 to reach peak (shorter = faster rise)
  // postPeakDrop: fraction of effOvr lost per year after peak
  // Higher OVR → faster ramp, slower decline (elite players are further ahead earlier)
  const ovrT = Math.max(0, Math.min(1, (ovr - 60) / 39)); // 0 at OVR60, 1 at OVR99
  const TRAJ = {
    EARLY_BLOOM: { peakAge: 24, rampYears: 2,  postPeakDrop: 0.018 - ovrT * 0.006 },
    CONSISTENT:  { peakAge: 26, rampYears: 4,  postPeakDrop: 0.022 - ovrT * 0.006 },
    LATE_BLOOM:  { peakAge: 28, rampYears: 6,  postPeakDrop: 0.028 - ovrT * 0.007 },
    STREAKY:     { peakAge: 25, rampYears: 3,  postPeakDrop: 0.035 - ovrT * 0.008 },
    FLASH:       { peakAge: 23, rampYears: 1,  postPeakDrop: 0.055 - ovrT * 0.010 },
  };
  const { peakAge, rampYears, postPeakDrop } = TRAJ[trajectory];

  // Seeded LCG for per-season events — same career arc every time called.
  let seed = nh ^ (ovr * 1234567);
  const rng = () => {
    seed = (Math.imul(seed | 0, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };

  const career = [];
  const history = [];
  const totals  = {};
  let bestSeasonOvr = 0;

  for (let i = 0; i < seasonsPlayed; i++) {
    const seasonYear = currentYear - seasonsPlayed + i;
    const seasonAge  = 22 + i;

    // ── Base trajectory factor ─────────────────────────────────────────
    let baseFactor;
    if (seasonAge <= peakAge) {
      // Pre-peak: non-linear ramp using a power curve (accelerating rise)
      const t = rampYears > 0 ? Math.min(1, (seasonAge - 22) / rampYears) : 1;
      // Power 0.7 gives a concave-up curve: slow start, fast approach to peak
      // Elite players get a flatter (more linear) early career since they were
      // good right away. Less-elite players have a steeper approach.
      const power = 0.55 + ovrT * 0.35;  // 0.55 for avg, 0.90 for elite
      baseFactor = 0.68 + 0.32 * Math.pow(t, power);
    } else {
      // Post-peak: linear decline, slope tuned per trajectory and OVR
      const yearsPast = seasonAge - peakAge;
      baseFactor = 1.0 - yearsPast * postPeakDrop;
    }

    // ── Per-season events (seeded, so stable) ─────────────────────────
    let eventMod = 0;
    const roll = rng();
    if (i === 1 && rng() < 0.28) {
      // Sophomore slump — common enough to be realistic
      eventMod = -(0.05 + rng() * 0.08);
    } else if (roll < 0.06) {
      // Breakout / career-best season
      eventMod = 0.08 + rng() * 0.09;
    } else if (roll < 0.13) {
      // Injury / down year
      eventMod = -(0.11 + rng() * 0.11);
    } else if (roll < 0.22) {
      // Hot streak / contract year
      eventMod = 0.04 + rng() * 0.06;
    }
    // STREAKY careers get amplified swings
    if (trajectory === "STREAKY") eventMod *= 1.9;

    const totalFactor = Math.max(0.46, Math.min(1.12, baseFactor + eventMod));

    // Small gaussian-ish noise on top (±2 OVR)
    const microNoise = (rng() + rng() - 1.0) * 2;
    const effOvr = Math.round(Math.min(99, Math.max(44, ovr * totalFactor + microNoise)));
    if (effOvr > bestSeasonOvr) bestSeasonOvr = effOvr;

    const stats = mockSeasonStats(pos, effOvr, player.archetype);
    stats.year = seasonYear;
    stats.age  = seasonAge;
    stats.ovr  = effOvr;
    stats.accolades = generateAccolades(player, stats, effOvr, seasonAge);
    career.push(stats);

    const histRow = {
      season: seasonYear, year: seasonYear, age: seasonAge, ovr: effOvr,
      teamId: null, teamName: "—", pos,
    };
    for (const [k, v] of Object.entries(stats)) {
      if (typeof v === "number") {
        histRow[k] = v;
        totals[k] = (totals[k] || 0) + v;
      }
    }
    history.push(histRow);
  }
  player.career       = career;
  player.careerTotals = computeCareerTotals(career, pos);
  player.careerHistory = history;
  player.careerStats   = totals;
  player._trajectory   = trajectory;   // visible on player card for flavor
  const all = career.flatMap(s => s.accolades || []);
  player.proBowls = all.filter(a => a === "Pro Bowl").length;
  player.allPros  = all.filter(a => a === "All-Pro").length;
  player.sbRings  = all.filter(a => a === "Super Bowl").length;
  player.mvps     = all.filter(a => a === "MVP").length;
  player.opoys    = all.filter(a => a === "OPOY").length;
  player.dpoys    = all.filter(a => a === "DPOY").length;
  player.roys     = all.filter(a => a === "ROY").length;
  player.records  = generateRecords(player, career, bestSeasonOvr);
}

// Stamp realistic team names onto each player's past-season history rows.
// Called once rosters are assembled into a franchise so we know the
// player's CURRENT team. Most vets stay put their whole career; ~25%
// are "well-traveled" and have 1-2 past seasons on a former team.
// Choice is deterministic from the player name hash so reloads stay
// stable.
function assignCareerTeams(rosters) {
  for (const [teamIdStr, roster] of Object.entries(rosters || {})) {
    const teamId = Number(teamIdStr);
    const team = getTeam(teamId);
    if (!team) continue;
    const teamName = `${team.city} ${team.name}`;
    for (const p of roster) {
      const hist = p.careerHistory || [];
      if (!hist.length) continue;
      let h = 0;
      for (const c of (p.name || "")) h = (h * 31 + c.charCodeAt(0)) | 0;
      const ah = Math.abs(h);
      const isWellTraveled = (ah % 100) < 25;
      const formerTeam = isWellTraveled
        ? TEAMS.filter(t => t.id !== teamId)[(ah >> 4) % (TEAMS.length - 1)]
        : null;
      const formerName = formerTeam ? `${formerTeam.city} ${formerTeam.name}` : null;
      // First half of career on former team; second half on current team.
      const switchAt = Math.max(1, Math.floor(hist.length / 2));
      for (let i = 0; i < hist.length; i++) {
        if (isWellTraveled && i < switchAt && formerTeam) {
          hist[i].teamId = formerTeam.id;
          hist[i].teamName = formerName;
        } else {
          hist[i].teamId = teamId;
          hist[i].teamName = teamName;
        }
      }
    }
  }
}

function mockSeasonStats(pos, ovr, archetype) {
  const noise = () => (Math.random() - 0.4) * 0.30 + 1;   // 0.85–1.16 typical
  const r = (n) => Math.round(n);

  // --- Games played: scale by ovr tier, clamp [1, 17] ---
  let gp;
  if (ovr >= 82)      gp = Math.round(14 + Math.random() * 3);
  else if (ovr >= 72) gp = Math.round(10 + Math.random() * 6);
  else if (ovr >= 62) gp = Math.round(5  + Math.random() * 7);
  else                gp = Math.round(1  + Math.random() * 5);
  gp = Math.min(17, Math.max(1, gp));

  const gpF = gp / 17;
  // rc() scales a full-season base count down to games-played equivalent
  const rc = (n) => Math.round(n * gpF);

  if (pos === "QB") {
    // --- base formula variables ---
    let attBase = (420 + (ovr - 70) * 9);
    let cmpPct  = Math.min(0.74, Math.max(0.48, 0.55 + (ovr - 70) * 0.0045));
    let ypa     = Math.max(5.2, 6.6 + (ovr - 70) * 0.06);
    let tdBase  = (18 + (ovr - 70) * 0.65);
    let intBase = (16 - (ovr - 70) * 0.22);

    // --- archetype modifiers (applied to base variables) ---
    let addRush = false;
    if (archetype === "GUNSLINGER") {
      tdBase  *= 1.25; intBase *= 1.30; ypa += 0.5; cmpPct -= 0.03;
    } else if (archetype === "GAME_MANAGER") {
      cmpPct  += 0.05; tdBase *= 0.75; intBase *= 0.65;
    } else if (archetype === "DUAL_THREAT") {
      cmpPct  -= 0.03; addRush = true;
    } else if (archetype === "FIELD_GENERAL") {
      cmpPct  += 0.03; intBase *= 0.75; ypa += 0.2;
    }
    cmpPct = Math.min(0.74, Math.max(0.48, cmpPct));

    // --- final counting stats ---
    const att  = Math.max(rc(60), rc(attBase * noise()));
    const comp = r(att * cmpPct);
    const yds  = r(att * ypa * noise());
    const td   = Math.max(rc(2), rc(tdBase * noise()));
    const ints = Math.max(rc(2), rc(Math.max(1, intBase) * noise()));

    const result = { gp, pass_att: att, pass_comp: comp, pass_yds: yds, pass_td: td, pass_int: ints };

    if (addRush) {
      const rush_att = rc((40 + (ovr - 70) * 1.5) * noise());
      const rush_yds = Math.round(rush_att * (4.5 + (ovr - 70) * 0.04) * noise());
      const rush_td  = Math.max(0, rc((3 + (ovr - 70) * 0.10) * noise()));
      result.rush_att = rush_att; result.rush_yds = rush_yds; result.rush_td = rush_td;
    }
    return result;
  }

  if (pos === "RB") {
    // --- base formula variables ---
    let attBase = (175 + (ovr - 70) * 6);
    let ypc     = Math.min(5.4, Math.max(3.1, 3.6 + (ovr - 70) * 0.038));
    let recBase = (20  + (ovr - 70) * 0.7);

    // --- archetype modifiers ---
    if (archetype === "POWER") {
      attBase *= 1.15; ypc -= 0.15; recBase *= 0.50;
    } else if (archetype === "ELUSIVE") {
      attBase *= 0.88; ypc += 0.25;
    } else if (archetype === "SPEED") {
      attBase *= 0.80; ypc += 0.45; recBase *= 0.65;
    } else if (archetype === "WORKHORSE") {
      attBase *= 1.20;
    } else if (archetype === "RECEIVING") {
      attBase *= 0.55; recBase *= 1.90;
    }
    ypc = Math.min(5.4, Math.max(3.1, ypc));

    // --- final counting stats ---
    const att = Math.max(rc(40), rc(attBase * noise()));
    const yds = r(att * ypc * noise());
    const td  = Math.max(rc(1), rc((6 + (ovr - 70) * 0.22) * noise()));
    const rec = Math.max(0, rc(recBase * noise()));
    return { gp, rush_att: att, rush_yds: yds, rush_td: td, rec, rec_yds: r(rec * 8.5) };
  }

  if (pos === "WR") {
    // --- base formula variables ---
    let tgtBase = (95  + (ovr - 70) * 3.5);
    let recRate = Math.min(0.78, Math.max(0.5, 0.60 + (ovr - 70) * 0.003));
    let yprBase = Math.min(17, Math.max(8, 12 + (ovr - 70) * 0.09));
    let tdBase  = (5   + (ovr - 70) * 0.18);

    // --- archetype modifiers ---
    if (archetype === "DEEP_THREAT") {
      tgtBase *= 0.72; yprBase *= 1.42; recRate -= 0.07; tdBase *= 1.10;
    } else if (archetype === "POSSESSION") {
      tgtBase *= 1.18; yprBase *= 0.80; recRate += 0.09; tdBase *= 0.80;
    } else if (archetype === "SLOT") {
      tgtBase *= 1.28; yprBase *= 0.88; recRate += 0.04;
    } else if (archetype === "RED_ZONE") {
      tgtBase *= 0.75; yprBase *= 0.82; tdBase  *= 1.55;
    } else if (archetype === "ROUTE_RUNNER") {
      recRate += 0.07; tgtBase *= 1.05;
    }
    recRate = Math.min(0.78, Math.max(0.5, recRate));
    yprBase = Math.min(17, Math.max(8, yprBase));

    // --- final counting stats ---
    const tgt = Math.max(rc(20), rc(tgtBase * noise()));
    const rec = r(tgt * recRate);
    const yds = r(rec * yprBase * noise());
    const td  = Math.max(0, rc(tdBase * noise()));
    return { gp, rec_tgt: tgt, rec, rec_yds: yds, rec_td: td };
  }

  if (pos === "TE") {
    // --- base formula variables ---
    let tgtBase = (70  + (ovr - 70) * 3.5);
    let recRate = Math.min(0.78, Math.max(0.5, 0.60 + (ovr - 70) * 0.003));
    let yprBase = Math.min(17, Math.max(8, 11 + (ovr - 70) * 0.09));
    let tdBase  = (4   + (ovr - 70) * 0.18);

    // --- archetype modifiers ---
    if (archetype === "BLOCKING") {
      tgtBase *= 0.28; tdBase *= 0.45; recRate -= 0.08;
    } else if (archetype === "RECEIVING") {
      tgtBase *= 1.25; yprBase *= 1.08;
    }
    recRate = Math.min(0.78, Math.max(0.5, recRate));
    yprBase = Math.min(17, Math.max(8, yprBase));

    // --- final counting stats ---
    const tgt = Math.max(rc(20), rc(tgtBase * noise()));
    const rec = r(tgt * recRate);
    const yds = r(rec * yprBase * noise());
    const td  = Math.max(0, rc(tdBase * noise()));
    return { gp, rec_tgt: tgt, rec, rec_yds: yds, rec_td: td };
  }

  if (pos === "DL") {
    // --- base formula variables ---
    let skBase  = Math.max(1.5, 4 + (ovr - 70) * 0.30);
    let tklBase = Math.max(10,  45 + (ovr - 70) * 1.2);
    const ffBase  = Math.max(0.5, 1 + (ovr - 70) * 0.04);
    const pdBase  = Math.max(1,   3 + (ovr - 70) * 0.10);

    // --- archetype modifiers ---
    if (archetype === "SPEED" || archetype === "PENETRATOR") {
      skBase  *= 1.45; tklBase *= 0.80;
    } else if (archetype === "POWER") {
      skBase  *= 0.75; tklBase *= 1.30;
    } else if (archetype === "TECHNICIAN") {
      skBase  *= 1.15;
    }
    // TWEENER: no change

    // --- final counting stats ---
    const sk  = Math.round(Math.max(0, rc(skBase  * noise())) * 10) / 10;
    const tkl = Math.max(0, rc(tklBase * noise()));
    const ff  = Math.max(0, rc(ffBase  * noise()));
    const pd  = Math.max(0, rc(pdBase  * noise()));
    return { gp, sk, tkl, ff, pd };
  }

  if (pos === "LB") {
    // --- base formula variables ---
    let skBase  = Math.max(0.8, 2 + (ovr - 70) * 0.20);
    let tklBase = Math.max(25,  70 + (ovr - 70) * 1.6);
    const ffBase  = Math.max(0.5, 1 + (ovr - 70) * 0.04);
    let intBase = Math.max(0.5, 1 + (ovr - 70) * 0.06);

    // --- archetype modifiers ---
    if (archetype === "BLITZER") {
      skBase  *= 1.70; tklBase *= 0.72; intBase *= 0.45;
    } else if (archetype === "THUMPER") {
      skBase  *= 0.50; tklBase *= 1.35; intBase *= 0.40;
    } else if (archetype === "COVER") {
      skBase  *= 0.65; tklBase *= 0.78; intBase *= 2.10;
    }
    // SIGNAL / HYBRID: no change

    // --- final counting stats ---
    const sk       = Math.round(Math.max(0, rc(skBase  * noise())) * 10) / 10;
    const tkl      = Math.max(0, rc(tklBase * noise()));
    const ff       = Math.max(0, rc(ffBase  * noise()));
    const int_made = Math.max(0, rc(intBase * noise()));
    return { gp, sk, tkl, ff, int_made };
  }

  if (pos === "CB") {
    // --- base formula variables ---
    let intBase = Math.max(0.5, 2  + (ovr - 70) * 0.14);
    let pdBase  = Math.max(2,   10 + (ovr - 70) * 0.50);
    let tklBase = Math.max(12,  50 + (ovr - 70) * 0.7);

    // --- archetype modifiers ---
    if (archetype === "BALL_HAWK") {
      intBase *= 1.65; pdBase  *= 0.80; tklBase *= 1.15;
    } else if (archetype === "SHUTDOWN") {
      intBase *= 0.45; pdBase  *= 1.35;
    } else if (archetype === "PHYSICAL") {
      tklBase *= 1.40; intBase *= 0.80;
    } else if (archetype === "ZONE") {
      pdBase  *= 1.45; intBase *= 0.65; tklBase *= 0.82;
    } else if (archetype === "SLOT_CB") {
      tklBase *= 1.15;
    }

    // --- final counting stats ---
    const int_made = Math.max(0, rc(intBase * noise()));
    const pd       = Math.max(0, rc(pdBase  * noise()));
    const tkl      = Math.max(0, rc(tklBase * noise()));
    return { gp, int_made, pd, tkl };
  }

  if (pos === "S") {
    // --- base formula variables ---
    let intBase = Math.max(0.5, 1  + (ovr - 70) * 0.10);
    let tklBase = Math.max(20,  75 + (ovr - 70) * 1.0);
    let pdBase  = Math.max(1.5, 6  + (ovr - 70) * 0.30);
    const skBase  = Math.max(0.4, 1  + (ovr - 70) * 0.05);

    // --- archetype modifiers ---
    if (archetype === "BALL_HAWK") {
      intBase *= 1.80; tklBase *= 0.78;
    } else if (archetype === "BOX") {
      intBase *= 0.38; tklBase *= 1.50; pdBase  *= 0.70;
    } else if (archetype === "CENTER_FIELD") {
      intBase *= 1.25; tklBase *= 0.62; pdBase  *= 1.30;
    }
    // HYBRID: no change

    // --- final counting stats ---
    const int_made = Math.max(0, rc(intBase * noise()));
    const tkl      = Math.max(0, rc(tklBase * noise()));
    const pd       = Math.max(0, rc(pdBase  * noise()));
    const sk       = Math.round(Math.max(0, rc(skBase  * noise())) * 10) / 10;
    return { gp, int_made, tkl, pd, sk };
  }

  if (pos === "OL") {
    const pen           = Math.max(0, rc((4 - (ovr - 70) * 0.08) * noise()));
    const sacks_allowed = Math.max(0, rc((4 - (ovr - 70) * 0.07) * noise()));
    return { gp, gs: gp, sacks_allowed, penalties: pen };
  }

  return { gp };
}

function generateAccolades(player, season, effOvr, seasonAge) {
  const acc = [];
  // Pro Bowl — needs ~88+ OVR season; some elite hover at 84+
  if (effOvr >= 92 && Math.random() < 0.80) acc.push("Pro Bowl");
  else if (effOvr >= 88 && Math.random() < 0.55) acc.push("Pro Bowl");
  else if (effOvr >= 84 && Math.random() < 0.20) acc.push("Pro Bowl");
  // All-Pro — needs Pro Bowl + truly elite
  if (acc.includes("Pro Bowl") && effOvr >= 93 && Math.random() < 0.35) acc.push("All-Pro");
  // Super Bowl ring — random per season, slightly weighted by OVR
  if (Math.random() < 0.05 + Math.max(0, (effOvr - 75) / 200)) acc.push("Super Bowl");
  // MVP — extremely rare, only top QBs/RBs/WRs
  if (effOvr >= 96 && Math.random() < 0.20 && ["QB","RB","WR"].includes(player.position)) acc.push("MVP");
  // OPOY / DPOY — slightly less rare than MVP
  if (effOvr >= 94 && Math.random() < 0.15) {
    if (["QB","RB","WR","TE"].includes(player.position)) acc.push("OPOY");
    else if (["DL","LB","CB","S"].includes(player.position)) acc.push("DPOY");
  }
  // Rookie of the Year — first season only
  if (seasonAge <= 23 && effOvr >= 82 && Math.random() < 0.06) acc.push("ROY");
  return acc;
}

function computeCareerTotals(career, pos) {
  const totals = { gp: 0,
    pass_att: 0, pass_comp: 0, pass_yds: 0, pass_td: 0, pass_int: 0,
    rush_att: 0, rush_yds: 0, rush_td: 0,
    rec_tgt: 0, rec: 0, rec_yds: 0, rec_td: 0,
    tkl: 0, sk: 0, int_made: 0, ff: 0, pd: 0,
  };
  for (const s of career) {
    for (const k of Object.keys(totals)) {
      if (s[k] != null) totals[k] += s[k];
    }
  }
  // Round sacks to 1 decimal (they're floats)
  totals.sk = Math.round(totals.sk * 10) / 10;
  return totals;
}

function generateRecords(player, career, bestOvr) {
  const records = [];
  if (bestOvr < 95) return records;   // only legends hold records
  const pos = player.position;
  const best = career.reduce((a, b) => (b.ovr > (a?.ovr || 0) ? b : a), null);
  if (!best) return records;
  if (pos === "QB" && best.pass_yds >= 5000)   records.push(`${best.pass_yds} pass yds (${best.year})`);
  if (pos === "QB" && best.pass_td >= 45)       records.push(`${best.pass_td} pass TDs (${best.year})`);
  if (pos === "RB" && best.rush_yds >= 1800)    records.push(`${best.rush_yds} rush yds (${best.year})`);
  if (pos === "RB" && best.rush_td >= 18)       records.push(`${best.rush_td} rush TDs (${best.year})`);
  if (pos === "WR" && best.rec_yds >= 1600)     records.push(`${best.rec_yds} rec yds (${best.year})`);
  if (pos === "WR" && best.rec_td >= 15)        records.push(`${best.rec_td} rec TDs (${best.year})`);
  if (pos === "DL" && best.sk >= 18)             records.push(`${best.sk} sacks (${best.year})`);
  if (pos === "LB" && best.tkl >= 160)           records.push(`${best.tkl} tackles (${best.year})`);
  if ((pos === "CB" || pos === "S") && best.int_made >= 9) records.push(`${best.int_made} INTs (${best.year})`);
  return records;
}
// Generates a player whose name isn't already in `blockNames`. Falls back to
// appending a roman-numeral suffix after exhausting random retries.
function genUniquePlayer(pos, tier, blockNames) {
  const block = blockNames || new Set();
  let p = genPlayer(pos, tier);
  let attempts = 0;
  while (block.has(p.name) && attempts < 30) {
    p = genPlayer(pos, tier);
    attempts++;
  }
  if (block.has(p.name)) {
    const suffixes = ["II", "III", "IV", "V", "VI", "VII"];
    for (const s of suffixes) {
      const candidate = `${p.name} ${s}`;
      if (!block.has(candidate)) { p.name = candidate; break; }
    }
  }
  return p;
}
function genRoster(playbook = PLAYBOOKS.BALANCED, overrides = {}, blockNames = null) {
  const r = [];
  const used = new Set(blockNames || []);
  for (const [pos, count] of Object.entries(ROSTER_SLOTS)) {
    for (let i = 0; i < count; i++) {
      let tier;
      if (i === 0) tier = overrides[pos] || playbook.tierBias[pos] || "good";
      else if (i === 1) tier = "average";
      else tier = "poor";
      const player = genUniquePlayer(pos, tier, used);
      used.add(player.name);
      r.push(player);
    }
  }
  // Resolve per-team jersey number conflicts (best player keeps their college
  // digit; rookies whose # is taken switch to a position-pool alternate).
  assignTeamJerseyNumbers(r);
  return r;
}

