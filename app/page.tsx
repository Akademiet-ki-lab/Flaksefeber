import Game from "./Game";
import OldLeaderboard from "./OldLeaderboard";
import { getDb, legacyLeaderboard, legacyFetchedAt } from "../lib/server/db";

// reads the old leaderboard from the database on each visit
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="layout">
      <OldLeaderboard rows={legacyLeaderboard(getDb())} fetchedAt={legacyFetchedAt} />
      <div className="stage" id="stage">
        <div className="frame" id="frame">
          <canvas
            id="c"
            role="img"
            aria-label="Spillflate: en havørn flyr mellom grantrær i snø"
          ></canvas>

          <div className="intro" id="intro" hidden>
            <div className="head">
              <h1>Flaksefeber</h1>
              <p>
                Hold havørnen høyt over granskogen og fly mellom trærne uten å
                treffe.
              </p>
              <p className="record" id="record"></p>
              <p id="goalLine">Klarer du alle 100?</p>
            </div>
            <div className="tap" id="tap">
              Trykk for å flakse
            </div>
            <div className="skins" id="skins">
              <div className="lvl" id="lvl"></div>
              <div className="xpbar">
                <i id="xpFill"></i>
              </div>
              <div className="picker">
                <button
                  className="arrow"
                  id="arenaPrev"
                  type="button"
                  aria-label="Forrige arena"
                >
                  &#8249;
                </button>
                <div className="skinname" aria-live="polite">
                  <strong id="arenaName"></strong>
                  <small id="arenaInfo"></small>
                </div>
                <button
                  className="arrow"
                  id="arenaNext"
                  type="button"
                  aria-label="Neste arena"
                >
                  &#8250;
                </button>
              </div>
              <div className="picker">
                <button
                  className="arrow"
                  id="skinPrev"
                  type="button"
                  aria-label="Forrige skin"
                >
                  &#8249;
                </button>
                <div className="skinname" aria-live="polite">
                  <strong id="skinName"></strong>
                  <small id="skinInfo"></small>
                </div>
                <button
                  className="arrow"
                  id="skinNext"
                  type="button"
                  aria-label="Neste skin"
                >
                  &#8250;
                </button>
              </div>
              <div className="feather" id="featherInfo"></div>
            </div>
          </div>

          <div className="screen" id="menu">
            <div className="head">
              <h1>Flaksefeber</h1>
              <p>
                Hold havørnen høyt over granskogen og fly mellom trærne uten å
                treffe.
              </p>
            </div>
            <div className="modes">
              <button className="mode" id="modeNormal" type="button">
                Vanlig<small>10 arenaer · 100 trær · XP og skins</small>
              </button>
              <button className="mode comp" id="modeComp" type="button">
                Konkurranse<small>Ingen grense · kom øverst på topplisten</small>
              </button>
            </div>
            <button className="link" id="menuLb" type="button">
              Se toppliste &#8250;
            </button>
            {/* hidden button: the credit leads to the admin login */}
            <p className="credit">
              <a className="secret" href="/admin" tabIndex={-1}>
                Laget av Aksel Craig
              </a>
            </p>
          </div>

          <div className="screen" id="compForm" hidden>
            <button className="back" id="formBack" type="button">
              &#8249; Meny
            </button>
            <form className="card" id="compFormEl" autoComplete="off">
              <h2>Konkurranse</h2>
              <label htmlFor="compName">Navn</label>
              <input
                type="text"
                id="compName"
                maxLength={20}
                placeholder="Skriv navnet ditt"
                autoComplete="off"
              />
              <label id="klassLabel">Klasse</label>
              <div
                className="chips"
                id="klasser"
                role="group"
                aria-labelledby="klassLabel"
              ></div>
              <button className="btn primary" id="compStart" type="submit" disabled>
                Start konkurranse
              </button>
            </form>
          </div>

          <button className="back menu-btn" id="toMenu" type="button" hidden>
            &#8249; Meny
          </button>
          <div className="hud" id="compHud" hidden>
            <span id="hudName"></span>
            <span className="hud-best" id="hudBest"></span>
          </div>

          <div
            className="end"
            id="end"
            role="dialog"
            aria-labelledby="endTitle"
            hidden
          >
            <h2 id="endTitle"></h2>
            <div className="score">
              <span id="endScore">0</span>
              <small id="endUnit">av 100 trær</small>
            </div>
            <p className="best" id="endBest"></p>
            <p className="xp" id="endXp"></p>
            <div className="actions">
              <button className="btn primary" id="again" type="button">
                Spill på nytt
              </button>
              <button className="btn" id="share" type="button">
                Del score
              </button>
              <button className="btn" id="endLb" type="button" hidden>
                Toppliste
              </button>
              <button className="btn" id="endMenu" type="button" hidden>
                Meny
              </button>
            </div>
            <p className="msg" id="shareMsg" aria-live="polite"></p>
            <p className="shareout" id="shareOut" hidden>
              <input
                id="shareText"
                type="text"
                readOnly
                aria-label="Tekst som kan kopieres"
              />
            </p>
          </div>

          <div
            className="screen lb"
            id="lb"
            role="dialog"
            aria-labelledby="lbTitle"
            hidden
          >
            <div className="card">
              <h2 id="lbTitle">Toppliste</h2>
              <div className="tabs" id="lbTabs"></div>
              <div className="tbl" id="lbRows"></div>
              <button className="btn" id="lbClose" type="button">
                Lukk
              </button>
            </div>
          </div>
        </div>
        <Game />
      </div>
    </div>
  );
}
