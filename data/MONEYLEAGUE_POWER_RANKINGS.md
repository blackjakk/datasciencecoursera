<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Bebas+Neue&display=swap');
    body { font-family: 'Inter', -apple-system, system-ui, sans-serif;
           max-width: 780px; margin: 18px auto; padding: 0 22px;
           color: #1a1d24; line-height: 1.5; font-size: 10.5pt;
           background: #ffffff; }
    h1 { font-family: 'Bebas Neue', sans-serif; font-size: 38pt;
         letter-spacing: 1px; margin: 0; color: #0a3d62;
         line-height: 1; }
    .hero { background: linear-gradient(135deg, #0a3d62 0%, #1f7a8c 100%);
            color: white; padding: 22px 26px; border-radius: 14px;
            margin-bottom: 22px; }
    .hero h1 { color: white; }
    .hero .subtitle { color: rgba(255,255,255,0.85); font-size: 11pt;
                      margin: 6px 0 0; font-weight: 500; }
    h2 { font-family: 'Bebas Neue', sans-serif; font-size: 22pt;
         letter-spacing: 1px; color: #0a3d62; margin: 28px 0 4px;
         padding-bottom: 4px; border-bottom: 3px solid #d4a017; }
    h3 { font-size: 11pt; color: #3d405b; margin: 14px 0 4px;
         font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .subtitle { color: #6b7280; margin: 0 0 14px; font-size: 10pt; }
    .chart { width: 100%; margin: 6px 0 14px; page-break-inside: avoid; }
    .cards-grid { display: grid; grid-template-columns: 1fr 1fr;
                  gap: 10px; margin: 10px 0; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;
            page-break-inside: avoid;
            box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
    .card-head { color: white; padding: 10px 12px; display: flex;
                 align-items: center; gap: 12px; }
    .ovr { font-family: 'Bebas Neue', sans-serif; font-size: 32pt;
           font-weight: bold; min-width: 46px; text-align: center;
           line-height: 1; }
    .player-name { font-size: 14pt; font-weight: 800; line-height: 1.1; }
    .archetype { font-size: 8.5pt; opacity: 0.92; margin-top: 3px;
                 font-weight: 500; }
    .card-body { padding: 8px 12px 10px; }
    .attr-table { width: 100%; font-size: 8.5pt; }
    .attr-table td { padding: 2px 4px; }
    .attr { font-weight: 700; color: #3d405b; width: 38px;
            font-size: 8pt; letter-spacing: 0.4px; }
    .bar { width: 100%; }
    .bar-fill { height: 8px; border-radius: 4px; background: #888;
                min-width: 4px; }
    .val { width: 24px; text-align: right; font-weight: 800;
           color: #1a1d24; }
    .raw { color: #6b7280; font-size: 8pt; text-align: right;
           min-width: 90px; }
    .badge-fmr { font-size: 7pt; background: rgba(0,0,0,0.3); color: #fff;
                 padding: 1px 5px; border-radius: 4px;
                 vertical-align: middle; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 12px;
            font-size: 9.5pt; }
    th { background: #0a3d62; color: white; padding: 5px 8px;
         text-align: left; font-weight: 700; }
    td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
    tr:nth-child(even) td { background: #fafafa; }
    .note { font-size: 9pt; color: #6b7280; margin: 4px 0 14px;
            line-height: 1.5; }
    .top3 { font-size: 9.5pt; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
            border-radius: 8px; overflow: hidden; }
    .top3 th { display: none; }
    .top3 td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; }
    .stat-cards { display: grid; grid-template-columns: repeat(4, 1fr);
                  gap: 8px; margin: 8px 0 14px; }
    .stat-card { background: #f7f4ea; border-radius: 10px; padding: 10px 12px;
                 text-align: center; border: 1px solid #e5e7eb; }
    .stat-card .num { font-family: 'Bebas Neue', sans-serif;
                       font-size: 22pt; color: #0a3d62; line-height: 1; }
    .stat-card .lbl { font-size: 8pt; color: #6b7280; margin-top: 4px;
                      text-transform: uppercase; letter-spacing: 0.5px;
                      font-weight: 600; }
    .section-intro { color: #3d405b; font-size: 10pt; margin: 4px 0 10px; }
    @page { size: letter; margin: 0.45in; }
    </style></head><body>
<div class="hero">
<h1>MONEYLEAGUE POWER RANKINGS</h1>
<p class="subtitle">May 2026 · 15-year retrospective · Madden-style attribute scoring · charts + cards</p>
</div>
<div class="stat-cards"><div class="stat-card"><div class="num">15</div><div class="lbl">Yrs of History</div></div><div class="stat-card"><div class="num">14</div><div class="lbl">Champions Crowned</div></div><div class="stat-card"><div class="num">164</div><div class="lbl">Trades Logged</div></div><div class="stat-card"><div class="num">90</div><div class="lbl">Top OVR</div></div></div>
<h2>All-Time Power Rankings</h2>
<p class="section-intro">OVR is a weighted composite: <strong>Rings 30%</strong>, <strong>Win% 20%</strong>, <strong>Draft 17%</strong>, Trade 13%, PPG 12%, Longevity 8%. Each attribute is normalized 0-99 within the active-vet pool. <strong>FMR</strong> = former manager.</p>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/ovr_all.png"/>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/radar_top.png"/>
<h2>All-Time Player Cards</h2>
<div class="cards-grid">

    <div class="card">
      <div class="card-head" style="background:#b8860b">
        <div class="ovr">90</div>
        <div class="card-name">
          <div class="player-name">Dave <span class="badge-fmr">FMR</span></div>
          <div class="archetype">Franchise Player · Franchise</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:83%;background:#b8860b"></div></td><td class="val">83</td><td class="raw">2 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:92%;background:#b8860b"></div></td><td class="val">92</td><td class="raw">102-59 (0.634)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:83%;background:#b8860b"></div></td><td class="val">83</td><td class="raw">134.3</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:99%;background:#b8860b"></div></td><td class="val">99</td><td class="raw">129.2/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:99%;background:#b8860b"></div></td><td class="val">99</td><td class="raw">+4718 (27t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:84%;background:#b8860b"></div></td><td class="val">84</td><td class="raw">12 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#1f7a4d">
        <div class="ovr">86</div>
        <div class="card-name">
          <div class="player-name">Trevor</div>
          <div class="archetype">Iron-man 3-Ring Vet · Star</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">3 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:86%;background:#1f7a4d"></div></td><td class="val">86</td><td class="raw">120-81 (0.597)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:77%;background:#1f7a4d"></div></td><td class="val">77</td><td class="raw">131.9</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:77%;background:#1f7a4d"></div></td><td class="val">77</td><td class="raw">118.1/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:71%;background:#1f7a4d"></div></td><td class="val">71</td><td class="raw">+727 (51t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">15 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#c08810">
        <div class="ovr">84</div>
        <div class="card-name">
          <div class="player-name">Coop</div>
          <div class="archetype">Iron-man 3-Ring Vet · Pro Bowler</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:99%;background:#c08810"></div></td><td class="val">99</td><td class="raw">3 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:75%;background:#c08810"></div></td><td class="val">75</td><td class="raw">106-95 (0.527)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:67%;background:#c08810"></div></td><td class="val">67</td><td class="raw">128.0</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:81%;background:#c08810"></div></td><td class="val">81</td><td class="raw">120.2/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:73%;background:#c08810"></div></td><td class="val">73</td><td class="raw">+1039 (41t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#c08810"></div></td><td class="val">99</td><td class="raw">15 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#c0540a">
        <div class="ovr">78</div>
        <div class="card-name">
          <div class="player-name">Brower</div>
          <div class="archetype">Regular-Season MVP, No Lombardi · Solid Starter</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#c0540a"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:99%;background:#c0540a"></div></td><td class="val">99</td><td class="raw">66-31 (0.680)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#c0540a"></div></td><td class="val">99</td><td class="raw">140.4</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:96%;background:#c0540a"></div></td><td class="val">96</td><td class="raw">127.8/pick · 102p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:76%;background:#c0540a"></div></td><td class="val">76</td><td class="raw">+1426 (21t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:60%;background:#c0540a"></div></td><td class="val">60</td><td class="raw">7 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#c0540a">
        <div class="ovr">75</div>
        <div class="card-name">
          <div class="player-name">Kyle</div>
          <div class="archetype">Multi-Ring Vet · Solid Starter</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:83%;background:#c0540a"></div></td><td class="val">83</td><td class="raw">2 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:71%;background:#c0540a"></div></td><td class="val">71</td><td class="raw">101-101 (0.500)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:61%;background:#c0540a"></div></td><td class="val">61</td><td class="raw">125.7</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:71%;background:#c0540a"></div></td><td class="val">71</td><td class="raw">115.1/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:69%;background:#c0540a"></div></td><td class="val">69</td><td class="raw">+464 (26t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#c0540a"></div></td><td class="val">99</td><td class="raw">15 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">74</div>
        <div class="card-name">
          <div class="player-name">Eric</div>
          <div class="archetype">Solid Pro · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:66%;background:#7a4a1f"></div></td><td class="val">66</td><td class="raw">1 ring</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:75%;background:#7a4a1f"></div></td><td class="val">75</td><td class="raw">106-96 (0.525)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:67%;background:#7a4a1f"></div></td><td class="val">67</td><td class="raw">128.1</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:88%;background:#7a4a1f"></div></td><td class="val">88</td><td class="raw">123.9/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:60%;background:#7a4a1f"></div></td><td class="val">60</td><td class="raw">-879 (15t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#7a4a1f"></div></td><td class="val">99</td><td class="raw">15 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">74</div>
        <div class="card-name">
          <div class="player-name">Ankur</div>
          <div class="archetype">Rookie Champion · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:66%;background:#7a4a1f"></div></td><td class="val">66</td><td class="raw">1 ring</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:80%;background:#7a4a1f"></div></td><td class="val">80</td><td class="raw">39-31 (0.557)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:74%;background:#7a4a1f"></div></td><td class="val">74</td><td class="raw">130.8</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:96%;background:#7a4a1f"></div></td><td class="val">96</td><td class="raw">127.5/pick · 68p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:68%;background:#7a4a1f"></div></td><td class="val">68</td><td class="raw">+235 (9t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">5 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">69</div>
        <div class="card-name">
          <div class="player-name">Troy</div>
          <div class="archetype">Solid Pro · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:66%;background:#7a4a1f"></div></td><td class="val">66</td><td class="raw">1 ring</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:69%;background:#7a4a1f"></div></td><td class="val">69</td><td class="raw">85-90 (0.486)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:66%;background:#7a4a1f"></div></td><td class="val">66</td><td class="raw">127.9</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:66%;background:#7a4a1f"></div></td><td class="val">66</td><td class="raw">112.9/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:69%;background:#7a4a1f"></div></td><td class="val">69</td><td class="raw">+466 (23t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:89%;background:#7a4a1f"></div></td><td class="val">89</td><td class="raw">13 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">65</div>
        <div class="card-name">
          <div class="player-name">Brian</div>
          <div class="archetype">Long-Tenured Underdog · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:62%;background:#7a4a1f"></div></td><td class="val">62</td><td class="raw">88-112 (0.440)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:57%;background:#7a4a1f"></div></td><td class="val">57</td><td class="raw">124.4</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:82%;background:#7a4a1f"></div></td><td class="val">82</td><td class="raw">120.6/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:71%;background:#7a4a1f"></div></td><td class="val">71</td><td class="raw">+661 (46t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#7a4a1f"></div></td><td class="val">99</td><td class="raw">15 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#a02020">
        <div class="ovr">63</div>
        <div class="card-name">
          <div class="player-name">Lem</div>
          <div class="archetype">Long-Tenured Underdog · Bench</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:65%;background:#a02020"></div></td><td class="val">65</td><td class="raw">93-109 (0.460)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:58%;background:#a02020"></div></td><td class="val">58</td><td class="raw">124.8</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:70%;background:#a02020"></div></td><td class="val">70</td><td class="raw">114.8/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:60%;background:#a02020"></div></td><td class="val">60</td><td class="raw">-854 (20t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#a02020"></div></td><td class="val">99</td><td class="raw">15 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#a02020">
        <div class="ovr">56</div>
        <div class="card-name">
          <div class="player-name">Donnie</div>
          <div class="archetype">Lucky-Ring Owner · Bench</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:66%;background:#a02020"></div></td><td class="val">66</td><td class="raw">1 ring</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">59-104 (0.362)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">121.5</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">105.0/pick · 178p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:40%;background:#a02020"></div></td><td class="val">40</td><td class="raw">-3777 (36t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:84%;background:#a02020"></div></td><td class="val">84</td><td class="raw">12 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#a02020">
        <div class="ovr">54</div>
        <div class="card-name">
          <div class="player-name">Tim</div>
          <div class="archetype">Cellar Dweller · Bench</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:55%;background:#a02020"></div></td><td class="val">55</td><td class="raw">49-75 (0.395)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:55%;background:#a02020"></div></td><td class="val">55</td><td class="raw">123.4</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:56%;background:#a02020"></div></td><td class="val">56</td><td class="raw">107.8/pick · 140p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:52%;background:#a02020"></div></td><td class="val">52</td><td class="raw">-2077 (14t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:70%;background:#a02020"></div></td><td class="val">70</td><td class="raw">9 yrs</td></tr>
        </table>
      </div>
    </div>
    
</div>
<h2>Win% vs Scoring</h2>
<p class="section-intro">Where each manager lives on the win-rate / scoring plane. The top-right is the dream; the bottom-left is the basement. Bubble size = rings.</p>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/scatter.png"/>
<h2>Trade Fleecer Ledger</h2>
<p class="section-intro">Net VBD across every scored trade (Yahoo 2011-2022 + Sleeper 2023-2024), including picks (scored as the rookie-year production of the player actually drafted). Green = won, red = lost.</p>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/vbd.png"/>
<h2>Best Drafters</h2>
<p class="section-intro">Rookie-year nflverse points produced by every player each manager drafted, normalized per pick. Minimum 20 career picks to qualify.</p>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/drafters.png"/>
<h2>Championship Timeline</h2>
<p class="section-intro">15 years of titles, one trophy per season. Rows ordered by total ring count.</p>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/champs.png"/>
<h2>Sleeper Era (2023-2025)</h2>
<p class="section-intro">The last 3 seasons only — recency view. Weights tilt away from longevity (5%) and toward draft (22%) and win% (22%). All 12 current rosters included regardless of tenure.</p>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/ovr_sleeper.png"/>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/sleeper_trend.png"/>
<img class="chart" src="/home/user/datasciencecoursera/data/charts/rankings/radar_sleeper.png"/>
<h2>Sleeper Era Player Cards</h2>
<div class="cards-grid">

    <div class="card">
      <div class="card-head" style="background:#1f7a4d">
        <div class="ovr">89</div>
        <div class="card-name">
          <div class="player-name">Trevor</div>
          <div class="archetype">Rookie Champion · Star</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">1 ring</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:78%;background:#1f7a4d"></div></td><td class="val">78</td><td class="raw">25-17 (0.595)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:88%;background:#1f7a4d"></div></td><td class="val">88</td><td class="raw">136.1</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:91%;background:#1f7a4d"></div></td><td class="val">91</td><td class="raw">138.6/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:84%;background:#1f7a4d"></div></td><td class="val">84</td><td class="raw">+205 (12t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#1f7a4d">
        <div class="ovr">86</div>
        <div class="card-name">
          <div class="player-name">Coop</div>
          <div class="archetype">Rookie Champion · Star</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">1 ring</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:65%;background:#1f7a4d"></div></td><td class="val">65</td><td class="raw">20-22 (0.476)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:66%;background:#1f7a4d"></div></td><td class="val">66</td><td class="raw">125.7</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:93%;background:#1f7a4d"></div></td><td class="val">93</td><td class="raw">143.2/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">+590 (6t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#1f7a4d">
        <div class="ovr">85</div>
        <div class="card-name">
          <div class="player-name">Brower</div>
          <div class="archetype">Regular-Season MVP, No Lombardi · Star</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#1f7a4d"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">33-9 (0.786)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">141.6</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:93%;background:#1f7a4d"></div></td><td class="val">93</td><td class="raw">143.6/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:96%;background:#1f7a4d"></div></td><td class="val">96</td><td class="raw">+520 (10t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#1f7a4d"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#c08810">
        <div class="ovr">80</div>
        <div class="card-name">
          <div class="player-name">Eric</div>
          <div class="archetype">Rookie Champion · Pro Bowler</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:99%;background:#c08810"></div></td><td class="val">99</td><td class="raw">1 ring</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:63%;background:#c08810"></div></td><td class="val">63</td><td class="raw">19-23 (0.452)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:71%;background:#c08810"></div></td><td class="val">71</td><td class="raw">127.8</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:90%;background:#c08810"></div></td><td class="val">90</td><td class="raw">134.8/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:60%;background:#c08810"></div></td><td class="val">60</td><td class="raw">-407 (8t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#c08810"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">72</div>
        <div class="card-name">
          <div class="player-name">Troy</div>
          <div class="archetype">Long-Tenured Underdog · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:65%;background:#7a4a1f"></div></td><td class="val">65</td><td class="raw">20-22 (0.476)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:81%;background:#7a4a1f"></div></td><td class="val">81</td><td class="raw">132.9</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:89%;background:#7a4a1f"></div></td><td class="val">89</td><td class="raw">130.0/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:81%;background:#7a4a1f"></div></td><td class="val">81</td><td class="raw">+132 (4t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#7a4a1f"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">71</div>
        <div class="card-name">
          <div class="player-name">Donnie</div>
          <div class="archetype">Long-Tenured Underdog · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:65%;background:#7a4a1f"></div></td><td class="val">65</td><td class="raw">20-22 (0.476)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:83%;background:#7a4a1f"></div></td><td class="val">83</td><td class="raw">134.0</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:87%;background:#7a4a1f"></div></td><td class="val">87</td><td class="raw">125.4/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:70%;background:#7a4a1f"></div></td><td class="val">70</td><td class="raw">-145 (5t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#7a4a1f"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">71</div>
        <div class="card-name">
          <div class="player-name">Ankur</div>
          <div class="archetype">Steady Vet, Still Chasing · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:78%;background:#7a4a1f"></div></td><td class="val">78</td><td class="raw">25-17 (0.595)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:65%;background:#7a4a1f"></div></td><td class="val">65</td><td class="raw">125.3</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:93%;background:#7a4a1f"></div></td><td class="val">93</td><td class="raw">144.3/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:61%;background:#7a4a1f"></div></td><td class="val">61</td><td class="raw">-388 (2t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#7a4a1f"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">68</div>
        <div class="card-name">
          <div class="player-name">Kyle</div>
          <div class="archetype">Long-Tenured Underdog · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:65%;background:#7a4a1f"></div></td><td class="val">65</td><td class="raw">20-22 (0.476)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">117.8</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:82%;background:#7a4a1f"></div></td><td class="val">82</td><td class="raw">107.5/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:90%;background:#7a4a1f"></div></td><td class="val">90</td><td class="raw">+356 (5t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#7a4a1f"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#7a4a1f">
        <div class="ovr">68</div>
        <div class="card-name">
          <div class="player-name">Lem</div>
          <div class="archetype">Cellar Dweller · Depth</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:50%;background:#7a4a1f"></div></td><td class="val">50</td><td class="raw">14-28 (0.333)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:58%;background:#7a4a1f"></div></td><td class="val">58</td><td class="raw">121.6</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:99%;background:#7a4a1f"></div></td><td class="val">99</td><td class="raw">164.9/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:78%;background:#7a4a1f"></div></td><td class="val">78</td><td class="raw">+54 (1t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#7a4a1f"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#a02020">
        <div class="ovr">64</div>
        <div class="card-name">
          <div class="player-name">Brian</div>
          <div class="archetype">Cellar Dweller · Bench</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">14-28 (0.333)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:63%;background:#a02020"></div></td><td class="val">63</td><td class="raw">124.2</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:85%;background:#a02020"></div></td><td class="val">85</td><td class="raw">116.7/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:70%;background:#a02020"></div></td><td class="val">70</td><td class="raw">-153 (11t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#a02020"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#a02020">
        <div class="ovr">64</div>
        <div class="card-name">
          <div class="player-name">Josh</div>
          <div class="archetype">Regular-Season MVP, No Lombardi · Bench</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:84%;background:#a02020"></div></td><td class="val">84</td><td class="raw">9-5 (0.643)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:76%;background:#a02020"></div></td><td class="val">76</td><td class="raw">130.5</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">0.0/pick · 0p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:76%;background:#a02020"></div></td><td class="val">76</td><td class="raw">+0 (0t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">1 yrs</td></tr>
        </table>
      </div>
    </div>
    

    <div class="card">
      <div class="card-head" style="background:#a02020">
        <div class="ovr">61</div>
        <div class="card-name">
          <div class="player-name">Tim</div>
          <div class="archetype">Long-Tenured Underdog · Bench</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:50%;background:#a02020"></div></td><td class="val">50</td><td class="raw">0 rings</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:58%;background:#a02020"></div></td><td class="val">58</td><td class="raw">17-25 (0.405)</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:51%;background:#a02020"></div></td><td class="val">51</td><td class="raw">118.2</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:88%;background:#a02020"></div></td><td class="val">88</td><td class="raw">127.9/pick · 34p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:40%;background:#a02020"></div></td><td class="val">40</td><td class="raw">-925 (5t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:99%;background:#a02020"></div></td><td class="val">99</td><td class="raw">3 yrs</td></tr>
        </table>
      </div>
    </div>
    
</div>
<h2>Methodology</h2>
<p class="note">Win/loss + PPG: regular-season games only (weeks 1-13 for 8/10-team years, 1-14 for 12-team years). Yahoo data via scraped matchups; Sleeper via league API. Rings: KNOWN_CHAMPIONS dict (Yahoo era) + winners_bracket.json (Sleeper era). Trade VBD: full-season nflverse fantasy points (0.5 PPR for 2019+, 0 PPR before) for players + rookie-year points of the player actually drafted at each traded pick (snake-order math against each year's actual draft data). Draft skill: total rookie-year points / total picks made. 2025 Sleeper trades excluded — no nflverse 2025 totals yet.</p>
</body></html>