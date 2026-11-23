// Kayıtlı demo oynatıcı: kamera videosu + sistemden kayıt sırasında okunan zaman çizelgesi (timeline.json).
// Hiçbir sonuç burada hesaplanmaz veya uydurulmaz; sayfa yalnızca kaydı zamanla eşleyip gösterir.
"use strict";

const SCENES = [
  { id: "gece", title: "Gece · Duvar ATM'si", sub: "kırmızı LED'li niş, tavan kamerası" },
  { id: "gunduz", title: "Gündüz · ATM kabini", sub: "kabin tavanındaki dome kamera" },
];

const FAULT_LABEL = {
  black_screen: "Siyah ekran", low_brightness: "Düşük parlaklık", excessive_brightness: "Aşırı parlaklık",
  contrast_degradation: "Kontrast kaybı", partial_blackout: "Kısmi ekran arızası", line_artifacts: "Ekran çizgileri",
  tearing: "Ekran yırtılması", color_distortion: "Renk bozulması", solid_color: "Düz renk ekran",
  error_screen: "Teknik hata ekranı", frozen_screen: "Olası donmuş ekran", display_defect: "Diğer ekran kusuru",
  privacy_pause: "Ekran izleme durduruldu", privacy_resume: "Ekran izleme yeniden başladı",
};
const FAULT_PLAIN = {
  black_screen: "Ekran tamamen kararmış. ATM müşteriye hizmet veremez; teknik ekip gerekir.",
  low_brightness: "Ekran normalden çok daha karanlık. Müşteri ekranı okumakta zorlanır.",
  excessive_brightness: "Ekran aşırı parlak, görüntü patlıyor. Arka ışıkta sorun olabilir.",
  contrast_degradation: "Ekran solmuş, yazılar zemin rengine karışıyor.",
  partial_blackout: "Ekranın bir bölümü kararmış. Panel veya arka ışık arızası olabilir.",
  line_artifacts: "Ekranda kalıcı çizgiler var. Panel veya kablo arızası belirtisi.",
  tearing: "Görüntü yatay olarak kayıyor (yırtılma). Görüntü kartı veya bağlantı sorunu olabilir.",
  color_distortion: "Ekran renkleri bozulmuş. Bir renk kanalı çalışmıyor olabilir.",
  solid_color: "Ekran tek renk gösteriyor, içerik yok.",
  error_screen: "Ekranda “hizmet dışı / teknik hata” mesajı okunuyor.",
  frozen_screen: "Ekran uzun süredir hiç değişmiyor; ekran donmuş olabilir.",
  display_defect: "Yapay zekâ modeli ekranda bir görüntü kusuru görüyor.",
};
const CNN_LABEL = {
  normal: "Normal ekran", solid_or_black_screen: "Siyah / tek renk ekran", display_tearing: "Kayan görüntü (yırtılma)",
  line_artifacts: "Çizgili ekran", other_display_defects: "Diğer kusur (renk, kısmi kararma)", error_screen: "Hata mesajı ekranı",
};
const METHOD = { rule: "görüntü ölçümü", cnn: "yapay zekâ modeli", ocr: "ekran yazısını okuma", temporal: "süre takibi", privacy: "gizlilik" };
const methods = (s) => (s || []).map((x) => METHOD[x] || x).join(" + ");
const fmtSec = (s) => (s == null ? "—" : `${s.toFixed(1).replace(".", ",")} sn`);
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const $ = (id) => document.getElementById(id);

const cam = $("cam"), scr = $("scr");
let data = null, scene = null, lastIdx = -1;

function describe(e) {
  if (!e) return { tone: "info", title: "Hazırlanıyor…", text: "" };
  if (e.privacy === "CUSTOMER_PRESENT" || e.privacy === "TRANSACTION_ACTIVE")
    return { tone: "priv", title: "Müşteri ATM’yi kullanıyor", text: "Gizlilik için ekran izlenmiyor ve kayıt alınmıyor. Müşteri ayrılınca izleme kendiliğinden yeniden başlar." };
  if (e.privacy === "ANALYSIS_SUSPENDED")
    return { tone: "priv", title: "Müşteri ayrıldı, kısa bekleme", text: "Alanın birkaç saniye boş kaldığından emin olunca ekran izlemeye dönülecek." };
  if (e.privacy === "STATE_UNKNOWN")
    return { tone: "priv", title: "Durum belirsiz, izleme durduruldu", text: "Sistem müşteri olup olmadığından emin olamadığında güvenli tarafta kalır ve ekrana bakmaz." };
  const conf = (e.faults || []).filter((f) => f.confirmed);
  if (conf.length) {
    const rank = (f) => (f.severity === "critical" ? 100 : 0) + (f.sources || []).length * 10;
    const w = [...conf].sort((a, b) => rank(b) - rank(a))[0];
    return { tone: w.severity === "critical" ? "crit" : "warn", title: `${FAULT_LABEL[w.fault] || w.fault} tespit edildi`,
      text: `${FAULT_PLAIN[w.fault] || w.detail || ""} (Nasıl anlaşıldı: ${methods(w.sources)})` };
  }
  if ((e.faults || []).length)
    return { tone: "info", title: "Olası bir sorun kontrol ediliyor…", text: "Tek bir kareye bakıp alarm verilmez; sorun birkaç ölçümde tekrar ederse alarm oluşur." };
  return { tone: "ok", title: "Ekran normal çalışıyor", text: "Kamera ATM ekranını izliyor; herhangi bir sorun görülmedi." };
}

function entryAt(t) {
  const tl = data.timeline;
  let lo = 0, hi = tl.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (tl[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

function renderState(t) {
  const i = entryAt(t);
  if (i !== lastIdx) {
    lastIdx = i;
    const e = i >= 0 ? data.timeline[i] : null;
    const d = describe(e);
    $("decision").className = `decision tone-${d.tone}`;
    $("dtitle").textContent = d.title;
    $("dtext").textContent = d.text;
    $("phase").textContent = e && e.phase ? e.phase : "Ekran normal; sistem izliyor";
    const busy = e && !e.allowed;
    const alarm = e && (e.faults || []).some((f) => f.confirmed);
    setStep("s2", e ? (busy ? "evet" : "hayır") : "—", busy ? "on-priv" : "on-ok");
    setStep("s3", e ? (busy ? "durduruldu (gizlilik)" : "yapılıyor") : "—", busy ? "on-priv" : "on-ok");
    setStep("s4", busy ? "—" : alarm ? "var" : "yok", alarm ? "on-crit" : "on-ok");
    renderProbs(e);
  }
  renderRows(t);
}

function setStep(id, text, cls) {
  const el = $(id);
  el.querySelector("b").textContent = text;
  el.className = `step ${cls}`;
}

function renderProbs(e) {
  const box = $("probs");
  if (!e || !e.allowed || !e.cnn || !e.cnn.probs) {
    box.innerHTML = `<p class="small muted">${e && !e.allowed ? "Müşteri varken model çalıştırılmaz (gizlilik)." : "—"}</p>`;
    return;
  }
  const items = Object.entries(e.cnn.probs).sort((a, b) => b[1] - a[1]);
  box.innerHTML = items.map(([k, v], n) => `
    <div class="prob${n === 0 ? " top" + (k !== "normal" ? " bad" : "") : ""}">
      <div class="pl"><span>${n === 0 ? `<b>${CNN_LABEL[k] || k}</b>` : CNN_LABEL[k] || k}</span><span class="mono">%${Math.round(v * 100)}</span></div>
      <div class="bar"><i style="width:${Math.max(1, v * 100)}%"></i></div>
    </div>`).join("");
  if (e.cnn.latency_ms) $("cnnnote").textContent = `MobileNetV3 sinir ağı, ${e.cnn.latency_ms.toFixed(1).replace(".", ",")} ms’de karar verdi. Ekranı 6 durumdan birine benzetir.`;
}

let rowsKey = "";
function renderRows(t) {
  const rows = data.rows;
  const key = rows.map((r) => (t >= r.done_t ? "d" : t >= r.applied_t ? "r" : "q")).join("");
  if (key === rowsKey) return;
  rowsKey = key;
  $("rows").innerHTML = rows.map((r, i) => {
    const st = key[i];
    const hidden = r.kind === "fault" && st !== "d";
    const label = hidden ? `<span class="lock">🔒 Gizli</span>` : r.label;
    const found = st === "d" ? (r.found ? FAULT_LABEL[r.found] || r.found : "Bulunamadı") : st === "r" ? `<span class="searching">aranıyor…</span>` : `<span class="muted">sırada</span>`;
    const res = st === "d" ? (r.correct ? `<span class="ok">✓ Doğru</span>` : `<span class="bad">✗ Yanlış</span>`) : "";
    return `<tr class="${st === "r" ? "running" : st === "q" ? "queued" : ""}" data-t="${r.applied_t}">
      <td>${r.n}</td><td>${label}</td><td class="found">${found}</td><td>${st === "d" ? methods(r.sources) : ""}</td>
      <td class="mono">${st === "d" ? fmtSec(r.seconds) : ""}</td><td>${res}</td></tr>`;
  }).join("");
  const done = rows.filter((r, i) => key[i] === "d");
  const ok = done.filter((r) => r.correct);
  const ft = done.filter((r) => r.kind === "fault" && r.correct && r.seconds != null).map((r) => r.seconds);
  const avg = ft.length ? ft.reduce((a, b) => a + b, 0) / ft.length : null;
  $("summary").innerHTML = `Doğru: <b>${ok.length} / ${done.length}</b> tamamlanan · toplam ${rows.length}` +
    (done.length === rows.length && avg != null ? ` · arızalar ortalama ${fmtSec(avg)} içinde bulundu` : "");
}

$("rows").addEventListener("click", (ev) => {
  const tr = ev.target.closest("tr");
  if (!tr) return;
  seekTo(Math.max(0, parseFloat(tr.dataset.t) - 1));
  play();
});

function seekTo(t) { cam.currentTime = t; scr.currentTime = t; lastIdx = -1; rowsKey = ""; renderState(t); }
function play() { cam.play(); scr.play(); $("bigplay").hidden = true; $("play").textContent = "Duraklat"; }
function pause() { cam.pause(); scr.pause(); $("play").textContent = "Oynat"; }

$("play").onclick = () => (cam.paused ? play() : pause());
$("bigplay").onclick = play;
$("speed").onchange = (e) => { cam.playbackRate = scr.playbackRate = parseFloat(e.target.value); };
$("seek").oninput = (e) => seekTo((e.target.value / 1000) * (cam.duration || 0));
cam.addEventListener("ended", () => { pause(); $("bigplay").hidden = false; });

function tick() {
  if (data) {
    const t = cam.currentTime;
    if (Math.abs(scr.currentTime - t) > 0.3) scr.currentTime = t;
    renderState(t);
    if (cam.duration) {
      $("seek").value = Math.round((t / cam.duration) * 1000);
      $("clock").textContent = `${fmtClock(t)} / ${fmtClock(cam.duration)}`;
    }
  }
  requestAnimationFrame(tick);
}

async function load(id) {
  pause();
  scene = SCENES.find((s) => s.id === id);
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === id)));
  data = null; lastIdx = -1; rowsKey = "";
  const r = await fetch(`rec/${id}/timeline.json`);
  data = await r.json();
  cam.src = `rec/${id}/camera.mp4`;
  scr.src = `rec/${id}/screen.mp4`;
  cam.playbackRate = scr.playbackRate = parseFloat($("speed").value);
  $("bigplay").hidden = false;
  const m = data.meta;
  $("atmline").innerHTML = `${m.atm_id} · ${m.name} · <span style="color:var(--text)">sistemin kararı</span>`;
  $("recdate").textContent = `kayıt: ${m.recorded_at}`;
  renderState(0);
}

$("tabs").innerHTML = SCENES.map((s) => `<button class="tab" role="tab" data-id="${s.id}"><b>${s.title}</b><span class="muted">${s.sub}</span></button>`).join("");
$("tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) load(b.dataset.id); });
load(SCENES[0].id);
requestAnimationFrame(tick);
