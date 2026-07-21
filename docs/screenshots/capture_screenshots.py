# -*- coding: utf-8 -*-
"""
Cattura screenshot delle schermate reali dell'app (servite dal server locale
node server.js su :8080) usando Playwright, iniettando dati di esempio dove
serve (login/API reali non disponibili in questo ambiente).
"""
from playwright.sync_api import sync_playwright
import os

BASE = "http://localhost:8080"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def out(name):
    return os.path.join(OUT_DIR, name)

MOCK_SETUP_JS = """
() => {
  const evSel = document.getElementById('eventSelect');
  evSel.innerHTML = '<option value="">Select event</option>';
  [['6','World Championship 2026'],['7','European Cup 2026'],['8','Regional Trials']].forEach(function(pair) {
    const opt = document.createElement('option');
    opt.value = pair[0]; opt.textContent = pair[1];
    evSel.appendChild(opt);
  });
  evSel.value = '6';
  evSel.disabled = false;

  const ringSel = document.getElementById('ringSelect');
  let ringHtml = '<option value="">Select ring</option>';
  for (let i = 1; i <= 10; i++) ringHtml += '<option value="' + i + '">Ring ' + i + '</option>';
  ringSel.innerHTML = ringHtml;
  ringSel.value = '3';

  const dot = document.getElementById('connectionDot');
  dot.classList.add('stable');
  document.getElementById('connectionText').textContent = 'Connection stable (42ms)';
  document.getElementById('versionTag').textContent = 'v1.0.0';
  document.getElementById('specialtySP').classList.add('selected');
  document.getElementById('continueBtn').disabled = false;

  const em = document.getElementById('errorModalOverlay');
  if (em) em.classList.add('hidden');
}
"""

MOCK_ADMIN_SP_JS = """
() => {
  var em = document.getElementById('errorModalOverlay');
  if (em) em.classList.add('hidden');
  var lo = document.getElementById('adminLoadingOverlay');
  if (lo) lo.classList.add('hidden');

  document.getElementById('categoryDisplay').textContent = 'Male -80kg Black Belt';
  document.getElementById('eventName').textContent = 'World Championship 2026';
  document.getElementById('ringNumber').textContent = '3';
  document.getElementById('nameLeft').textContent = 'J. SMITH';
  document.getElementById('nameRight').textContent = 'M. GARCIA';
  document.getElementById('flagLeft').src = '/images/flags/USA.png';
  document.getElementById('flagRight').src = '/images/flags/SPAIN.png';

  document.getElementById('roundIndicator').textContent = '1';
  document.getElementById('roundTotal').textContent = '3';
  document.getElementById('timerDisplay').textContent = '01:24';
  document.getElementById('stateText').textContent = 'PLAY';
  document.getElementById('stateText').className = 'state-text play';
  document.getElementById('stateDot').classList.add('play');

  document.getElementById('mainScoreLeft').textContent = '3';
  document.getElementById('mainScoreRight').textContent = '1';
  document.getElementById('wScoreLeft').textContent = '1';
  document.getElementById('wScoreRight').textContent = '0';
  document.getElementById('pScoreLeft').textContent = '0';
  document.getElementById('pScoreRight').textContent = '1';

  SharedAdmin.initReferees(4, 0);
  var state = SharedAdmin.getRefereeState();
  var samples = [
    {red: 3, blue: 1, connected: true},
    {red: 3, blue: 2, connected: true},
    {red: 2, blue: 1, connected: true},
    {red: 0, blue: 0, connected: false}
  ];
  for (var i = 1; i <= 4; i++) {
    state[i].score = { red: samples[i-1].red, blue: samples[i-1].blue };
    state[i].connected = samples[i-1].connected;
  }
  SharedAdmin.renderReferees();
}
"""

MOCK_WINNER_MODAL_JS = """
() => {
  document.getElementById('winnerScoreRedVal').textContent = '3';
  document.getElementById('winnerScoreBlueVal').textContent = '1';
  document.getElementById('winnerModalMessage').textContent =
    'All rounds have been completed. RED is currently ahead — confirm the winner below.';
  document.getElementById('winnerBtnRed').classList.add('suggested');
  document.getElementById('winnerModalOverlay').classList.remove('hidden');
}
"""

MOCK_ADMIN_PT_JS = """
() => {
  var em = document.getElementById('errorModalOverlay');
  if (em) em.classList.add('hidden');
  var lo = document.getElementById('adminLoadingOverlay');
  if (lo) lo.classList.add('hidden');

  document.getElementById('categoryDisplay').textContent = 'Female Pattern Black Belt';
  document.getElementById('eventName').textContent = 'World Championship 2026';
  document.getElementById('ringNumber').textContent = '2';
  document.getElementById('nameLeft').textContent = 'A. ROSSI';
  document.getElementById('nameRight').textContent = 'K. MULLER';
  document.getElementById('flagLeft').src = '/images/flags/ITALY.png';
  document.getElementById('flagRight').src = '/images/flags/GERMANY.png';
  document.getElementById('patternNameDisplay').textContent = 'GE-BAEK';

  document.getElementById('roundIndicator').textContent = '1';
  document.getElementById('roundTotal').textContent = '2';
  document.getElementById('stateText').textContent = 'PLAY';
  document.getElementById('stateText').className = 'state-text play';
  document.getElementById('stateDot').classList.add('play');

  document.getElementById('mainScoreLeft').textContent = '0';
  document.getElementById('mainScoreRight').textContent = '0';

  SharedAdmin.initReferees(5, 10);
  SharedAdmin.renderReferees();
}
"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 900, "height": 700}, device_scale_factor=2)

        # 1. LOGIN
        page.goto(BASE + "/login", wait_until="networkidle")
        page.screenshot(path=out("shot_login.png"))
        print("saved shot_login.png")

        # 2. SETUP (mocked)
        page.goto(BASE + "/intro", wait_until="networkidle")
        page.wait_for_timeout(800)
        page.evaluate(MOCK_SETUP_JS)
        page.wait_for_timeout(200)
        page.screenshot(path=out("shot_setup.png"))
        print("saved shot_setup.png")

        # 3. ADMIN SP (mocked) - wider viewport
        page2 = browser.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=1.5)
        page2.goto(BASE + "/admin?event=6&ring=3&specialty=SP&isGlobal=false", wait_until="load")
        page2.wait_for_timeout(1000)
        page2.evaluate(MOCK_ADMIN_SP_JS)
        page2.wait_for_timeout(200)
        page2.screenshot(path=out("shot_admin_sp.png"))
        print("saved shot_admin_sp.png")

        # 4. ADMIN SP - winner modal open
        page2.evaluate(MOCK_WINNER_MODAL_JS)
        page2.wait_for_timeout(200)
        page2.screenshot(path=out("shot_winner_modal.png"))
        print("saved shot_winner_modal.png")

        # 5. ADMIN PT (mocked)
        page3 = browser.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=1.5)
        page3.goto(BASE + "/admin?event=6&ring=2&specialty=PT&isGlobal=false", wait_until="load")
        page3.wait_for_timeout(1000)
        page3.evaluate(MOCK_ADMIN_PT_JS)
        page3.wait_for_timeout(200)
        page3.screenshot(path=out("shot_admin_pt.png"))
        print("saved shot_admin_pt.png")

        browser.close()


if __name__ == "__main__":
    main()
