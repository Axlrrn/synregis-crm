import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  writeBatch,
  arrayUnion,
  arrayRemove,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, browserLocalPersistence, setPersistence,
  signInWithEmailAndPassword, EmailAuthProvider, linkWithCredential, updatePassword, sendPasswordResetEmail } from "firebase/auth";

// ── Firebase ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBEn5vpXubd8JEd2Bh7ilZ-0bBHC8-y0nc",
  authDomain: "synregis-crm.firebaseapp.com",
  projectId: "synregis-crm",
  storageBucket: "synregis-crm.firebasestorage.app",
  messagingSenderId: "93754862526",
  appId: "1:93754862526:web:14e4318fb36ebff70967ef",
};
const fbApp = initializeApp(firebaseConfig);
// Offline-first cache: the full last-synced dataset is kept on-device, so a weak
// connection (Huawei / WebView) shows ALL leads instantly instead of a blank or
// half-loaded pipeline. Falls back to memory-only if IndexedDB is unavailable.
var db;
try {
  db = initializeFirestore(fbApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  db = initializeFirestore(fbApp, {});
}
const auth = getAuth(fbApp);
setPersistence(auth, browserLocalPersistence).catch(function(){});
const googleProvider = new GoogleAuthProvider();
const ALLOWED_EMAILS = ["axlrrn@gmail.com"];

// ── Design tokens ─────────────────────────────────────────────────────────────
const NAVY   = "#08111f";
const CARD   = "#0e1e35";
const CARD2  = "#122540";
const GOLD   = "#c4a96b";
const CREAM  = "#f0ece4";
const MUTED  = "#6b8aaa";
const BORDER = "#1c3550";
const INP    = "#091525";

const PIPELINE_STAGES = ["Prospecting","Proposal Sent","Negotiation","Due Diligence","Won","Lost","On Hold","Unwanted"];
const DEFAULT_REGIONS = ["North-West","North-Center","North-East","South-West","South-Center","South-East","Center-West","Center-East"];
const PROJECT_STAGES  = ["Pre-Launch/Off-Plan","Permitting & Planning","Under Construction","Finishing Works","Near Delivery","Delivered & Occupied","Stalled/Suspended","Unknown"];
const PRIORITIES      = ["Top Priority", "High", "Warm", "Cold", "Inbound Only"];

const PC = {
  "Prospecting":"#6b7280","Proposal Sent":"#3b82f6","Negotiation":"#8b5cf6",
  "Due Diligence":"#f59e0b","Won":"#10b981","Lost":"#ef4444","On Hold":"#9ca3af","Unwanted":"#6b5b45",
};
const PRC = {
  "Top Priority":"#ef4444","High":"#f59e0b","Warm":"#f97316","Cold":"#6b8aaa","Inbound Only":"#3b82f6",
};

// Light-on-dark variant (cream text, gold keys) for the navy header/splash —
// dark surfaces are immune to browser force-dark (Huawei dark mode).
const LOGO_SRC = "/logo_dark.png";
// Warm the browser cache for the splash/header logo before React even mounts, so
// it appears instantly instead of trickling in over a slow connection.
if (typeof Image !== "undefined") { try { var _logoPreload = new Image(); _logoPreload.src = LOGO_SRC; } catch (e) {} }

// ── Settings helpers ──────────────────────────────────────────────────────────
var DEFAULT_SETTINGS = { badge: true, banner: true, stale: true, browserNotif: false, appNotif: false, appNotifStale: false, notifTime: "09:00" };
function loadSettings() {
  try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem("synregis_settings") || "{}")); }
  catch(e) { return Object.assign({}, DEFAULT_SETTINGS); }
}
function saveSettingsLS(s) {
  try { localStorage.setItem("synregis_settings", JSON.stringify(s)); } catch(e) {}
}

// ── PWA install (desktop/PC) ──────────────────────────────────────────────────
// Chrome/Edge fire `beforeinstallprompt` once, often before React mounts. Stash
// the event at module load so the Settings "Install on this PC" button can fire it.
var _deferredInstall = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", function(e){
    e.preventDefault();
    _deferredInstall = e;
    window.dispatchEvent(new Event("synregis-installable"));
  });
  window.addEventListener("appinstalled", function(){
    _deferredInstall = null;
    window.dispatchEvent(new Event("synregis-installed"));
  });
}
function isStandalone() {
  if (typeof window === "undefined") return false;
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    || window.navigator.standalone === true;
}

// ── Activity / staleness helpers ──────────────────────────────────────────────
var STALE_DAYS = 14;
var ACTIVE_STAGES = ["Prospecting","Proposal Sent","Negotiation","Due Diligence"];
function lastActivityDate(lead) {
  var dates = [];
  if (lead.createdAt) dates.push(lead.createdAt);
  (lead.callLog || []).forEach(function(e){ if (e.date) dates.push(e.date); });
  (lead.meetingLog || []).forEach(function(e){ if (e.date) dates.push(e.date); });
  if (!dates.length) return "";
  dates.sort();
  return dates[dates.length - 1];
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  var diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  return diff < 0 ? 0 : diff;
}
// Days of silence on an active-pipeline lead, or null if not stale.
function staleDays(lead) {
  if (ACTIVE_STAGES.indexOf(lead.pipelineStage) === -1) return null;
  var d = daysSince(lastActivityDate(lead));
  return d !== null && d >= STALE_DAYS ? d : null;
}

// ── AI lead extraction (Gemini) ───────────────────────────────────────────────
// Tries model aliases in order so the integration survives Google renames.
var GEMINI_MODELS = ["gemini-flash-latest", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.0-flash"];

async function extractLeadWithAI(text, image, apiKey, regions, existingLeads) {
  var prompt =
    "You extract real-estate lead data for a property CRM in Mauritius. " +
    "The input below (text and/or a screenshot image) may describe ONE project or SEVERAL distinct projects. " +
    'Reply with ONLY a JSON object (no markdown): {"projects": [ ...one entry per distinct project... ]}\n' +
    "Each project entry:\n" +
    '{"projectName": string, "location": string, "promoteur": string (developer/company), ' +
    '"contactName": string (person names if mentioned, several separated by " / "), ' +
    '"phone": string (ALL phone numbers seen, as written, separated by " / "), ' +
    '"units": string (total units, e.g. \'24 units\'), "unitDetails": string (unit types/sizes/prices breakdown), ' +
    '"amenities": string (comma-separated), ' +
    '"region": string (one of: ' + regions.join(", ") + " — pick the best match for the location, or empty if unsure), " +
    '"notes": string (anything else useful for THIS project: prices, delivery dates, syndic fees, website, source), ' +
    '"existingId": string (if this project clearly is one of the EXISTING PIPELINE PROJECTS listed below — same project, even with spelling differences — put its id; otherwise empty string)}\n' +
    "Never merge different projects into one entry. Use an empty string for unknown fields. Never invent data.";
  if (existingLeads && existingLeads.length) {
    prompt += "\n\nEXISTING PIPELINE PROJECTS (id | name | promoteur | location):\n" +
      existingLeads.map(function(l){
        return l.id + " | " + (l.projectName || "") + " | " + (l.promoteur || "") + " | " + (l.location || "");
      }).join("\n");
  }
  var parts = [{ text: prompt }];
  if (text && text.trim()) parts.push({ text: "TEXT:\n" + text });
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  var lastError = null;
  for (var i = 0; i < GEMINI_MODELS.length; i++) {
    var res;
    try {
      res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODELS[i] + ":generateContent?key=" + encodeURIComponent(apiKey),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: parts }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        }
      );
    } catch (e) { lastError = new Error("Network error — check your connection."); continue; }
    if (res.status === 404) { lastError = new Error("No Gemini model available for this key."); continue; }
    if (!res.ok) {
      var err = await res.json().catch(function(){ return null; });
      throw new Error((err && err.error && err.error.message) || ("Gemini error " + res.status));
    }
    var data = await res.json();
    var out = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!out) throw new Error("Empty response from Gemini.");
    var parsed = JSON.parse(out);
    // Always return an array of project entries, whatever shape the model chose
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.projects)) return parsed.projects;
    return [parsed];
  }
  throw lastError || new Error("Extraction failed.");
}

// Merge AI-extracted fields into an existing lead: fill blanks, never overwrite;
// new/conflicting info goes to notes under a dated header.
function mergeExtractedIntoLead(lead, f, rawText, regionsList) {
  var merged = { ...lead };
  // Descriptive fields: keep existing, note differences.
  var fillable = ["location", "promoteur", "units", "unitDetails"];
  var conflicts = [];
  fillable.forEach(function(k){
    var nv = ((f && f[k]) || "").trim();
    if (!nv) return;
    if (!String(merged[k] || "").trim()) merged[k] = nv;
    else if (nv.toLowerCase() !== String(merged[k]).trim().toLowerCase()) conflicts.push(k + ": " + nv);
  });
  // Contact fields ACCUMULATE — existing values are never changed; new ones are
  // appended (deduped) and tagged " (AI)" so you can see what the AI added.
  var newPhoneRaw = ((f && f.phone) || "").trim();
  if (newPhoneRaw) {
    if (!String(merged.phone || "").trim()) {
      merged.phone = newPhoneRaw + " (AI)";
    } else {
      var have = phonesIn(merged.phone);
      var additions = newPhoneRaw.split(/[/;,]|\bou\b|\bet\b/i)
        .map(function(s){ return s.trim(); })
        .filter(function(s){
          var n = normalizePhone(s);
          return n.length >= 6 && have.indexOf(n) === -1;
        });
      if (additions.length) merged.phone = merged.phone + " / " + additions.map(function(s){ return s + " (AI)"; }).join(" / ");
    }
  }
  var newContact = ((f && f.contactName) || "").trim();
  if (newContact) {
    var curContact = String(merged.contactName || "").trim();
    if (!curContact) merged.contactName = newContact + " (AI)";
    else if (curContact.toLowerCase().indexOf(newContact.toLowerCase()) === -1) {
      merged.contactName = curContact + " / " + newContact + " (AI)";
    }
  }
  var newAmen = ((f && f.amenities) || "").trim();
  if (newAmen) {
    var curAmen = String(merged.amenities || "").trim();
    if (!curAmen) merged.amenities = newAmen + " (AI)";
    else {
      var haveAmen = curAmen.toLowerCase().split(",").map(function(s){ return s.trim(); });
      var addAmen = newAmen.split(",").map(function(s){ return s.trim(); })
        .filter(function(a){ return a && haveAmen.indexOf(a.toLowerCase()) === -1; });
      if (addAmen.length) merged.amenities = curAmen + ", " + addAmen.map(function(a){ return a + " (AI)"; }).join(", ");
    }
  }
  var region = ((f && f.region) || "").trim();
  if (!String(merged.region || "").trim() && (regionsList || []).indexOf(region) !== -1) merged.region = region;
  if (merged.promoteur && !String(merged.promoteurKey || "").trim()) {
    merged.promoteurKey = merged.promoteur.toLowerCase();
    merged.promoteurFull = merged.promoteur;
  }
  var today = new Date().toISOString().split("T")[0];
  var block = "--- AI update " + today + " ---";
  if (conflicts.length) block += "\nNew values seen (kept yours): " + conflicts.join(" | ");
  if (((f && f.notes) || "").trim()) block += "\n" + f.notes.trim();
  if ((rawText || "").trim()) block += "\nSource:\n" + rawText.trim();
  merged.notes = (String(merged.notes || "").trim() ? merged.notes + "\n\n" : "") + block;
  return merged;
}

// Build a complete new lead document from AI-extracted fields.
function buildLeadFromExtracted(f, regionsList) {
  f = f || {};
  var promoteur = (f.promoteur || "").trim();
  var region = (f.region || "").trim();
  var projectName = (f.projectName || "").trim() ||
    [promoteur, (f.location || "").trim()].filter(Boolean).join(" – ") || "Unnamed project";
  var today = new Date().toISOString().split("T")[0];
  return {
    projectName: projectName,
    location: (f.location || "").trim(),
    promoteur: promoteur,
    promoteurKey: promoteur.toLowerCase(),
    promoteurFull: promoteur,
    contactName: (f.contactName || "").trim(),
    phone: (f.phone || "").trim(),
    units: (f.units || "").trim(),
    unitDetails: (f.unitDetails || "").trim(),
    amenities: (f.amenities || "").trim(),
    projectStage: PROJECT_STAGES[0],
    pipelineStage: "Prospecting",
    priority: "",
    notes: ((f.notes || "").trim() ? "--- AI import " + today + " ---\n" + f.notes.trim() : ""),
    callLog: [],
    nextFollowUp: "",
    createdAt: today,
    region: (regionsList || []).indexOf(region) !== -1 ? region : "",
    gpsCoords: "",
  };
}

// ── Responsive helper ─────────────────────────────────────────────────────────
function useIsMobile() {
  var [mobile, setMobile] = useState(function(){
    return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  });
  useEffect(function() {
    var mq = window.matchMedia("(max-width: 640px)");
    function onChange(e){ setMobile(e.matches); }
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return function(){
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return mobile;
}

// ── Phone matching helpers ────────────────────────────────────────────────────
function normalizePhone(str) {
  if (!str) return "";
  var d = str.replace(/\D/g, "");
  if (d.length > 8) {
    if (d.startsWith("00230")) d = d.slice(5);
    else if (d.startsWith("230")) d = d.slice(3);
  }
  return d;
}
// A phone field may hold several numbers ("5712 3456 / 5777 8888") — normalize each.
function phonesIn(str) {
  if (!str) return [];
  return String(str).split(/[/;,]|\bou\b|\bet\b/i)
    .map(function(s){ return normalizePhone(s); })
    .filter(function(n){ return n.length >= 6; });
}

function extractPhones(text) {
  if (!text) return [];
  var matches = text.match(/\b\d[\d\s\-\.]{4,9}\d\b/g);
  if (!matches) return [];
  return matches.map(function(m){ return normalizePhone(m); }).filter(function(n){ return n.length >= 6; });
}
function findPhoneMatches(phone, leadId, allLeads) {
  if (!phone || !phone.trim()) return [];
  var norms = phonesIn(phone);
  if (!norms.length) {
    var single = normalizePhone(phone);
    if (!single || single.length < 6) return [];
    norms = [single];
  }
  var norm = norms[0];
  var results = [];
  (allLeads || []).forEach(function(l) {
    if (l.id === leadId) return;
    var theirs = phonesIn(l.phone);
    if (theirs.some(function(t){ return norms.indexOf(t) !== -1; })) {
      results.push({ lead: l, type: "exact" }); return;
    }
    if (l.notes && extractPhones(l.notes).indexOf(norm) !== -1) {
      results.push({ lead: l, type: "notes" }); return;
    }
    var callText = (l.callLog || []).map(function(e){ return e.note||""; }).join(" ");
    if (callText && extractPhones(callText).indexOf(norm) !== -1) {
      results.push({ lead: l, type: "calllog" }); return;
    }
    var meetText = (l.meetingLog || []).map(function(e){ return e.note||""; }).join(" ");
    if (meetText && extractPhones(meetText).indexOf(norm) !== -1) {
      results.push({ lead: l, type: "meetinglog" });
    }
  });
  return results;
}

// ── Export helper ─────────────────────────────────────────────────────────────
// Tiered so it works on PC browsers (download) AND inside the Android WebView,
// which silently ignores <a download> / data: URIs (no DownloadListener). There
// we fall back to the Web Share sheet so Axel can save to Files or send to self.
function exportFilename() {
  return "synregis_leads_" + new Date().toISOString().split("T")[0] + ".json";
}

// Trigger a real file download. Returns true if it was attempted (desktop), false
// if it should not be relied on (inside the Android WebView, which ignores it).
function downloadJson(s) {
  try {
    var blob = new Blob([s], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = exportFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    return true;
  } catch (e) { return false; }
}

function exportData(leads, onShowText) {
  var s = JSON.stringify(leads, null, 2);
  var inApp = typeof navigator !== "undefined" && /SynRegisApp/.test(navigator.userAgent);

  // Desktop / normal browsers: a Blob download produces a real .json file.
  if (!inApp && downloadJson(s)) return;

  // Inside the Android WebView, <a download> is ignored — try the native share
  // sheet (save to Files / send to self) if the WebView exposes it.
  try {
    if (typeof File !== "undefined" && navigator.canShare) {
      var file = new File([s], exportFilename(), { type: "application/json" });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: exportFilename() })
          .catch(function(){ if (onShowText) onShowText(s); });
        return;
      }
    }
  } catch (e) { /* fall through */ }

  // Guaranteed fallback: show the JSON on screen so it can always be copied.
  if (onShowText) onShowText(s);
}

// Shown when a file download/share isn't possible (Android WebView): the full
// JSON, always selectable and copyable, so the data can be taken elsewhere.
function ExportModal(props) {
  var s = props.text || "";
  var taRef = useRef(null);
  var [copied, setCopied] = useState(false);
  function selectAll() { if (taRef.current) { taRef.current.focus(); taRef.current.select(); } }
  function copy() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(s).then(
          function(){ setCopied(true); setTimeout(function(){ setCopied(false); }, 2000); },
          function(){ selectAll(); }
        );
        return;
      }
    } catch (e) { /* ignore */ }
    selectAll();
  }
  var ovl = { position:"fixed", inset:0, background:"#000000aa", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center", padding:16 };
  var box = { background:CARD, border:"1px solid "+BORDER, borderRadius:12, padding:20, width:560, maxWidth:"94vw", maxHeight:"90vh", display:"flex", flexDirection:"column" };
  return (
    <div style={ovl} onClick={function(e){ if(e.target===e.currentTarget) props.onClose(); }}>
      <div style={box}>
        <div style={{ fontSize:15, fontWeight:700, color:GOLD, marginBottom:6 }}>Export data ({props.count} projects)</div>
        <div style={{ fontSize:11, color:MUTED, marginBottom:10, lineHeight:1.5 }}>
          Copy this JSON to use elsewhere. On the phone, tap <b style={{color:GOLD}}>Copy</b> (or long-press the text → Select all → Copy).
        </div>
        <textarea ref={taRef} readOnly value={s} onFocus={selectAll}
          style={{ flex:1, minHeight:200, width:"100%", boxSizing:"border-box", background:INP, border:"1px solid "+BORDER,
            borderRadius:8, padding:10, color:CREAM, fontSize:11, fontFamily:"monospace", resize:"none", outline:"none", whiteSpace:"pre" }}/>
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <button onClick={copy}
            style={{ flex:1, padding:"9px", borderRadius:6, border:"none", background:copied?"#10b981":GOLD, color:copied?"#fff":NAVY, cursor:"pointer", fontWeight:700, fontSize:13 }}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button onClick={function(){ downloadJson(s); }}
            style={{ flex:1, padding:"9px", borderRadius:6, border:"1px solid "+GOLD, background:"transparent", color:GOLD, cursor:"pointer", fontWeight:700, fontSize:13 }}>
            Download file
          </button>
          <button onClick={props.onClose}
            style={{ padding:"9px 16px", borderRadius:6, border:"1px solid "+BORDER, background:"transparent", color:MUTED, cursor:"pointer", fontSize:13 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Map an arbitrary JSON object (our own export, or a loosely-shaped one) into the
// {projectName, location, ...} fields shape the extraction pipeline consumes.
// `id` becomes `existingId` so re-importing our own export matches existing leads.
function normalizeJsonEntry(o) {
  if (!o || typeof o !== "object") return null;
  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      var v = o[arguments[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  }
  return {
    projectName:  pick("projectName", "project", "name", "title"),
    location:     pick("location", "area", "place"),
    promoteur:    pick("promoteur", "developer", "promoter", "company", "builder"),
    contactName:  pick("contactName", "contact", "contactPerson", "contact_name"),
    phone:        pick("phone", "phones", "tel", "mobile", "phone_number", "contactPhone"),
    units:        pick("units", "unit", "totalUnits", "nbUnits"),
    unitDetails:  pick("unitDetails", "unitDetail", "unitTypes", "unit_details"),
    amenities:    pick("amenities", "facilities", "features"),
    region:       pick("region"),
    notes:        pick("notes", "note", "description", "details", "remarks"),
    existingId:   pick("existingId", "id"),
  };
}

// ── Initial seed data (86 leads) ──────────────────────────────────────────────
const INITIAL_LEADS = [
  {"id":"1","projectName":"The Twin Towers","location":"Flic en Flac","promoteur":"Bissendary Property Developer","promoteurKey":"bissendary","promoteurFull":"Bissendary Property Developer\nContact: —\nPhone: ‑5500 0070/525 41696\nEmail: —","contactName":"","phone":"5500 0070","units":"36 units","unitDetails":"36 units- 24(2beds)6.5m, 10(3 beds)8.5m, 2(Pent)on request","amenities":"Lift, cctv, manned gate, secured access, parking+visitor parking, generator, common tank and pump, garden, common roof terrace","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"2","projectName":"Onyra","location":"Les Flamands,Pereybere","promoteur":"Mayfair-Mauritius(mauritian company Ambus Limited) Director Nawaz Peerbux","promoteurKey":"mayfair","promoteurFull":"Mayfair-Mauritius(mauritian company Ambus Limited) Director Nawaz Peerbux-5806 4262/590 37935. Nishta Jhurree-57 75 76 52","contactName":"Director Nawaz Peerbux","phone":"5806 4262","units":"14 units","unitDetails":"14 units- 12(2 beds)7.05m, 2(Pent) On demand","amenities":"Pool, gated, cct, parking+visitors, gardens, lift, generator","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Mayfair has some projects completed- may hence already have a syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"3","projectName":"Eleganza","location":"Pereybere","promoteur":"Mayfair-Mauritius(mauritian company Ambus Limited) Director Nawaz Peerbux","promoteurKey":"mayfair","promoteurFull":"Mayfair-Mauritius(mauritian company Ambus Limited) Director Nawaz Peerbux-58064262/59037935. Nishta Jhurree-57 75 76 52","contactName":"Director Nawaz Peerbux","phone":"58064262","units":"12 units","unitDetails":"Resort Style- 12 Units-2(1 bed)4.95m, 8(2beds)6.5m, 2(3beds pent)8.5 to 11.5","amenities":"Wellness area/gym, seating and waterfall(water features), projector for outside viewing, BBQ area, lobby and welcome desk, parking(underground), gated, intercom","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Mayfair has some projects completed- may hence already have a syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"4","projectName":"Avanti","location":"Pereybere","promoteur":"Mayfair-Mauritius(mauritian company Ambus Limited) Director Nawaz Peerbux","promoteurKey":"mayfair","promoteurFull":"Mayfair-Mauritius(mauritian company Ambus Limited) Director Nawaz Peerbux-5806 4262/5903 7935. Nishta Jhurree-57 75 76 52","contactName":"Director Nawaz Peerbux","phone":"5806 4262","units":"12 units","unitDetails":"12 unit-10(2beds)6.2, 2(3 beds Pent)9.5m","amenities":"Gated, cctcv, pool, intercom, lawns, parking, lift, generator, each soler water heater","projectStage":"Near Delivery","pipelineStage":"Prospecting","priority":"High","notes":"Mayfair has some projects completed- may hence already have a syndic. construction 90% delivery scheduled for end of April\n---\nCall activity: 14/04/26-Called no answer 5903 7935 no answer,  tried also Jhurree's number no avail. Go Mme Anchal 59037935- told me to send a text she will discuss witht the owners on 15/04/26.15/04/26- called Anchal- she will speak to them tomorrow- she told me there is normally already a syndic for the projects already delivered. She told me by text that she forewarded my details to the owners, they will contact back.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"5","projectName":"The Ridge","location":"Floreal","promoteur":"Blueridge Investments","promoteurKey":"blueridge","promoteurFull":"Blueridge Investments, 5251 5755/233 4104","contactName":"","phone":"5251 5755","units":"57 units","unitDetails":"57 Units- 2(1bed)5.9, 38(2 beds)7.49, 14(3 beds)11.2, 3(Pent)14.9m","amenities":"Manned gate, CCTV, fire safety, common tank and pump, centralised satellite tv, garden and parking+visitor, 2 lifts, generator","projectStage":"Under Construction","pipelineStage":"On Hold","priority":"Cold","notes":"Delivery end 2026, re-engage Q4. Uses their own construction arm ASL construction, Blueridge first hosuing projects, did industrial/commercial projects and public projects, they are vertically integrated- To be delivered end of 2026","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"6","projectName":"Marbella","location":"Trianon","promoteur":"Blueridge Investments","promoteurKey":"blueridge","promoteurFull":"Blueridge Investments, 5251 5755/233 4104","contactName":"","phone":"5251 5755","units":"102 units","unitDetails":"102 Units- 12(1 bed)6.3, 28(2 beds)7.5, 43(3beds)11, 9(Pent)25, 10(Ground floor duplex villas)13.5","amenities":"Pool, Beach Club, walkways(skyview), massive green space(trop[ical garden + garden), gym, kid's play area, EV charging station, 3 lifts, generator, 24/7 manned gate, cctv, electronic access, parking 125(97 covered basement+28 visitors)","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"7","projectName":"One T Heaven-Sodnac","location":"","promoteur":"One T properties(real estate arm of Tayelamay and sons enterprise ltd","promoteurKey":"one t prop","promoteurFull":"One T properties(real estate arm of Tayelamay and sons enterprise ltd- 696 4838","contactName":"","phone":"696 4838","units":"140 units","unitDetails":"140 Units- 12(studio)6.6, 24(1 bed)7, 80(2 bed standard)8.3, 20 (2 bed premium)10.5, 3(pent)45, 1(Bridge Apartement)on request","amenities":"Pool, Gym Indoor, outdoor gym, zen place, aromatherapy garden, sauna and first aid room, clubhouse, kids zone, concierge(desk to manage guest), manned gate, cctv, electronic access, 3 lifts, generator","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"They use monolithic construction, all-poured concrete- improves sound proofing and structural lifespan. Not their first project, but first of this size, they had other projects of 12 apartements, where they tested their monolithic construction but made several other projects- NHDC, educational buildings etc. Delivery Q1-Q2 2027","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"8","projectName":"One T Vision","location":"Highlands","promoteur":"One T properties(real estate arm of Tayelamay and sons enterprise ltd","promoteurKey":"one t prop","promoteurFull":"One T properties(real estate arm of Tayelamay and sons enterprise ltd- 696 4838, Naheeda Suddo- project development manager, Dilsha Mottee- Project development assistant manager","contactName":"","phone":"696 4838","units":"12 units","unitDetails":"12 apt-6.6m","amenities":"Each unit has a parking space","projectStage":"Finishing Works","pipelineStage":"Prospecting","priority":"Cold","notes":"delivery aug 2026, same monolithic .. To check in line with One t heaven sodnac, not profitable on its own. For Iris, debatable given selling price. One T Vision is described as the first in a series of developments under the One T Properties brand Business Magazine — Tayelamay is building a pipeline of projects","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"9","projectName":"The 10 Living","location":"Smart city - Cote D'or","promoteur":"Green Technopark ltd- Ceo Sanhay Mungur(seems to be a problem with the the first","promoteurKey":"green","promoteurFull":"Green Technopark ltd- Ceo Sanhay Mungur(seems to be a problem with the the first name)","contactName":"","phone":"","units":"117 units","unitDetails":"117 Units- Phase 1(Block B)- 50 units. Phase 2 (Block A)-67 units, Phase 2- 15(1 bed)6.6, 32(2 beds)9.2, 14(3beds)13.8, 2(4beds) and 4 (pents) on request, Phase 1-12(1bed), 24(2bed), 10(3 beds),1(4 beds), 3(Pent)","amenities":"Heated Semi-olympic pool(150m2), children's pool, canal, 2500m2 of garden, shaded walking tracks, gym, yoga studio, rooftop lounge, EV charging, manned gate, cctv, card access, generator, smart city project hence commercial and business places too, plus commercial healthcare","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"10","projectName":"Marivana","location":"Grand Baie","promoteur":"Destination mauritius- can't seem to find the promoteur contacts, will have to g","promoteurKey":"destination","promoteurFull":"Destination mauritius- can't seem to find the promoteur contacts, will have to go through Nasani agency","contactName":"","phone":"","units":"8 units","unitDetails":"8 units- 8(2beds)","amenities":"Pool, garden, gated access, lift, intercom, generator","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"11","projectName":"Oryam","location":"Trou aux Biches","promoteur":"LDV developments(through Fillides company)- try contact Luxuriel group Director ","promoteurKey":"ldv","promoteurFull":"LDV developments(through Fillides company)- try contact Luxuriel group Director des operations- 268 1393. Luxuriel is the agency for the sale, to check as they will be in the middle, the promoteur himself is a small and goes to luxuriel, or 2682970- agency Michaël Zingraf","contactName":"Director des operations","phone":"268 1393","units":"28 units","unitDetails":"28 units- 8(2bed)no prices, 16(3 beds) 18.8, 4(pent)22.5m","amenities":"Pool , gym, generator, tank and pump, cctv, securitu, entry desk, lift","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"went through Engel and V- admin told , they are already renting 1 unit so maybe there is already a syndic in place. Called luxuriel- she took my number told she has to speak to Mr Anthony.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"12","projectName":"Résidence Mon Rêave","location":"","promoteur":"MHC","promoteurKey":"mhc","promoteurFull":"MHC- 5777 8131, 5803 4294(number for the project)","contactName":"","phone":"5777 8131","units":"44 units","unitDetails":"44 units-10(3 bed)8.9-10.8, 4(pent) 18m","amenities":"2 places per appartemnt(88 places+20 visitors), gym, infinity pool, 4 lifts(2 per blocks), generator, common pump and tank, manned gate, cctv, green space","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"High","notes":"Entry by the promoteur in 'haut de gamme'.\n---\nCall activity: 15/04/26- Got a Mr(forgot name), he is actually on leave, to contact Monday for a meeting- MHC will normally take up the syndic for the first year.- call Monday 20/04/26","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"13","projectName":"West 35","location":"Tamarin","promoteur":"Know House","promoteurKey":"know house","promoteurFull":"Know House-483 5000/483 5515","contactName":"","phone":"483 5000","units":"35 units","unitDetails":"35 units- 7(villas 3 beds)26.9, 28(duplex 3 beds)18.5m","amenities":"Guard, cctv, coworking space, parkings, generator, green area","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"Well Known promoteur-450+ produced, each villas has its pool- normally works with The Smart Syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"14","projectName":"Plage de la sérénité","location":"Mont Choisy","promoteur":"Know House","promoteurKey":"know house","promoteurFull":"Know House-483 5000/483 5515","contactName":"","phone":"483 5000","units":"7 units","unitDetails":"7 apt- 6 apt and 1 pent","amenities":"Infinity pool, cctv, 2 parking per unit","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"Not necessarily financially attractive project, but the promoteurs delivers a lot of projects.normally works with The Smart Syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"15","projectName":"The Edge","location":"","promoteur":"Know House","promoteurKey":"know house","promoteurFull":"Know House-483 5000/483 5515","contactName":"","phone":"483 5000","units":"office building- 6 storey","unitDetails":"office building- 6 storey","amenities":"having gyms, parkings, caffetaria etc","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"Not necessarily in prospection, but as said promoteur delivers a lot of projects.normally works with The Smart Syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"16","projectName":"Ocean Garden 2","location":"Flic en Flac","promoteur":"Diamond Estates","promoteurKey":"diamond","promoteurFull":"Diamond Estates-260 7777/244 3175/5742 4468, Mevin Bappoo- Coordinateur de Projet","contactName":"","phone":"260 7777","units":"7 units","unitDetails":"7 units-3(ground appartements)13.9, 3(ocean view-frist floor)23.2, 1(pent, last floor)35m","amenities":"Pool, lift, electric gate, cctv, utility box, generator, garden for gorund appartements","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"17","projectName":"The Peninsula","location":"Les Salines(Riviere Noire)","promoteur":"Edenrock propery developments, Sales Manager- Alexandre","promoteurKey":"edenrock","promoteurFull":"Edenrock propery developments, Sales Manager- Alexandre-5479 2929, main office 483 1515, Head of sales and developments- Derrick Doger de Speville","contactName":"","phone":"5479 2929","units":"40 units","unitDetails":"40 units(8 blocks)-32(3beds)88m, 115m for the premium, 8-(pent 3 beds) 155 beachfront and 185 royal","amenities":"Common pool and garden, clubhouse, gyms, tennis court, Guard, cctv","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Penthouse have splash pool each. Norally should have been delivered in2025, but it is still actively marketed by Pam G, maybe delayed. normally works with The Smart Syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"18","projectName":"Les résidence de la plage","location":"Flic en Flac","promoteur":"JMK Group","promoteurKey":"jmk","promoteurFull":"JMK Group-453 0000","contactName":"","phone":"453 0000","units":"18 units","unitDetails":"18 units- 15(3beds), 3(Pent)","amenities":"pool, green space, guard, cctv, electric fence, lift or lifts, generator, common tank and pump","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"The promoteur is a family company.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"19","projectName":"Z-Prime","location":"","promoteur":"Zidia","promoteurKey":"zidia","promoteurFull":"Zidia- 464 1212/ Mobile & whatsapp-5942 1212","contactName":"","phone":"464 1212","units":"20 units","unitDetails":"20 units- 8(2 beds)8.5, 10(3 beds)10.8, 2(Pent)18m","amenities":"Gym, rooftop lounge, card access, cctv, lift, generator, Parking","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"The promoteur is a seasoned one, some projects completed. May work with a syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"20","projectName":"Nautilus","location":"Pointe aux Biches","promoteur":"Neotown; SVP les salines development- Neotown(This is the mail etc)","promoteurKey":"neotown","promoteurFull":"Neotown; SVP les salines development- Neotown(This is the mail etc)- 213 6300/213 6302","contactName":"","phone":"213 6300","units":"22 units","unitDetails":"22 units- 18(3 beds)19.5, 4(Pent)35m","amenities":"Pool , guard, cctv, electric fence, garden, lift, generator, common tank and pump, parking","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"21","projectName":"Viva Calodyne","location":"Calodyne","promoteur":"Realist Development ltd","promoteurKey":"realist","promoteurFull":"Realist Development ltd- 5823 6722- Vijay Utcheegadoo Ceo(he was in management at 2 futures)","contactName":"","phone":"5823 6722","units":"24 units","unitDetails":"2 Phases- Villas and appartements, 24 apartements- 12(2 beds)17.5, 12(3 beds)20, 4(Pent)42m- Block A & B -£ beds, C & D- 2 beds, pents on top of each block. Villas- 14(Garden villas)26.5, 6(Signature villas)48-52m","amenities":"Lap pool(25x5), garden 2000m2, manned gate, cctv, spa relaxation area, a jogging track, generator, common tank, entry desk space, aprking, EV charging, 4 blocks(each with lift-4 to 8 lifts )","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"delivery 2027(confirmed via Holprop Listing)","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"22","projectName":"L'Horizon D'Anna","location":"Flic en Flac","promoteur":"Sunset Anna Ltd","promoteurKey":"sunset","promoteurFull":"Sunset Anna Ltd-468 1011- maybe to RAL consultingThey handle the admin of the promoteur(project manager), Mob/Whatsapp 5490 2245","contactName":"","phone":"468 1011","units":"20 units","unitDetails":"20 units- 2(1bed)7.7, 8(2 beds)12.9, 8(3beds)14.8, 2(Pent of 3 bed)on request","amenities":"park(5000m2), jogging path, gated residence, cctv, lift","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"23","projectName":"Zetwal","location":"Cap Tamarin","promoteur":"Trimetys Group","promoteurKey":"trimetys","promoteurFull":"Trimetys Group- 483 4977","contactName":"","phone":"483 4977","units":"33 units","unitDetails":"33 units- 9 townhouse(3 beds)20.7, 20 apts-10(1 beds)7.6, 10(2 bed)12, 4(Pent of 2 beds)20.6","amenities":"Ev charging, Green space, lift, gated","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"To check,a s it forms part of cpa tamarin smart village, may already have a syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"24","projectName":"Serenity Heights-Trianon","location":"","promoteur":"Bhunjun Group- Serenity heights Team","promoteurKey":"bhunjun","promoteurFull":"Bhunjun Group- Serenity heights Team- 5539 2179(Amal), 5539 2482(Isha)","contactName":"","phone":"5539 2179","units":"68 units","unitDetails":"68 units- 8(1 bed) 6.7-7.5, 28(2beds)10.7-11.5, 28(3beds)15.3-15.8, 4(Pent of 3 beds)25","amenities":"Massive green space 1500m2, garden 600m2, walkways, agted, acces control, cctv, 3 lifts, parking(125-97 covered and 28 uncovered), Ev stations, private storage for residens, basement technical facilities and parking, pool, gym , covered kiosk","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"25","projectName":"Central Park","location":"Trianon","promoteur":"Bhunjun Group- Beta Homes(betahomes.mu- to check if same people to contact for t","promoteurKey":"bhunjun","promoteurFull":"Bhunjun Group- Beta Homes(betahomes.mu- to check if same people to contact for this one- 5539 2179(Amal), 5539 2482(Isha)","contactName":"","phone":"5539 2179","units":"Unit count unconfirmed- but 2beds, 3beds","unitDetails":"Unit count unconfirmed- but 2beds, 3beds and 3 beds penthouses. Multi-block development (Block 3 + Block 4 confirmed from image refs) — tower + lower levels","amenities":"Pool, lounge & games room, BBQ & pizza area, private dining/workspace, fully equipped fitness room, kid's playground, lifts","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"delivery likely 2027-2028","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"26","projectName":"Lilow Residences","location":"Grand Baie","promoteur":"Colbert Holdings(Company formed 2012 by Sendylen Soobrayen ex accountant from EY","promoteurKey":"colbert","promoteurFull":"Colbert Holdings(Company formed 2012 by Sendylen Soobrayen ex accountant from EY)5942 8818/526 5221(commercial service) Ceo/director of properties Gavissen, Executive manager: Kelly Marion, Resp Marketing: Yoven, mathieu de la roche souvestre-consultant commerciale, he is in charge for skadia, christophe spoke to him-5942 9458","contactName":"","phone":"5942 8818","units":"42 units","unitDetails":"42 units- 24(2beds)11.5, 8(2 beds but larger)12.4, 4(2 beds larger again)14.7, 6 (Pent of 3 bed 144m2-177m2)33.6","amenities":"Common pool, plus pool for aqua-gym, spa 400m2(hamman cabins and massage zones), gardens, kiosks, clubhouse, BBQ, gated, conciergery 24/24(to be checked), lift, generator","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Christophe contacted for Skandia villas, they are unhappy with their syndic, there it is 5800, not unhappy because of price , reason unknown. Completion March 2027","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"27","projectName":"Domaine des Hautes Rives","location":"","promoteur":"Colbert Holdings(Company formed 2012 by Sendylen Soobrayen ex accountant from EY","promoteurKey":"colbert","promoteurFull":"Colbert Holdings 5942 8818/526 5221","contactName":"","phone":"5942 8818","units":"gated morcellement type -6 arpents- Phas","unitDetails":"gated morcellement type -6 arpents- Phase 1- 38 lots with BLUP villas, Phase 2-15 lots. Price at +-4.5m","amenities":"3 green spaces, maybe guard (in image), automated gate","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"They declared for thgis project 5000 as syndic fee, may already have the same syndic as complained","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"28","projectName":"Khloris Villas","location":"","promoteur":"Exclusive Edge, E.director- Lovelesh Ramsewak 5256 0657, sales Dhavish(or dhanis","promoteurKey":"exclusive edge","promoteurFull":"Exclusive Edge, E.director- Lovelesh Ramsewak 5256 0657, sales Dhavish(or dhanish to check) Toolsee-5256 0649, office- 267 0426","contactName":"","phone":"5256 0657","units":"28 units","unitDetails":"28 villas, 18.5 to 22m","amenities":"Tennis court, outdoor gym, Vtt for travel to grand-baie, green spaces(60%), guard 24/7","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"29","projectName":"The Summit","location":"Floreal","promoteur":"Habitation Classics Ltd, jayesh Shah(director) Key Rep, recognised developer hav","promoteurKey":"habitation classic","promoteurFull":"Habitation Classics Ltd, jayesh Shah(director) Key Rep, recognised developer having many notable projects.468 1414(Ebene). Another num found on Fb(the other is always busy)5783 6424","contactName":"","phone":"468 1414","units":"32 units","unitDetails":"32 units- 4(1bed)5.9, 14(2beds)7.2, 10(3beds)11.2, 4(Pent)18.8","amenities":"2 elevators, generator, garden, guard post, cctv, fire safety, common waste area, underground parking, 2 blocks with each their lift","projectStage":"Near Delivery","pipelineStage":"Prospecting","priority":"High","notes":"Represented by Park Lane, delivery July 2026.\n---\nCall activity: 15/04/2026 Got someone on 57836424- to call back he was in a meeting- call back at 19:30h- called, he cut the call.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"30","projectName":"Queen Mary Heights","location":"Floreal","promoteur":"Soproges ltee- Jimmy Lee(Key Figure), SVP- Floreal Residence ltd, Aurelie sales ","promoteurKey":"soproges","promoteurFull":"Soproges ltee- Jimmy Lee(Key Figure), SVP- Floreal Residence ltd, Aurelie sales manager- 427 8686/5842 3277","contactName":"","phone":"427 8686","units":"28 units","unitDetails":"28 units- 2(1bed)5.9, 12(2 beds stanbdard)6.8, 4(2 beds large)9.2, 8(3 beds)11.2, 2(pent) 12.5m","amenities":"Manned gate, cctv,lift(2 large one per block), generator, 1 parking per unit, garden","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"31","projectName":"Ebene Vantage","location":"Ebène","promoteur":"Ebene Green Development ltd- Ajay Gathani(MD)","promoteurKey":"ebene green","promoteurFull":"Ebene Green Development ltd- Ajay Gathani(MD)- 207 0666/5258 3515","contactName":"","phone":"207 0666","units":"39 units","unitDetails":"39 units- 12(1 bed) 6.5, 21(2beds)8.5, 3(3 beds)14.5, 3 (4beds Pent)23m","amenities":"Manned gate, electronic access, cctv, generator,  lifts, 1 parking per unit","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"delivery- June 2027","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"32","projectName":"Ovelia","location":"Ebène","promoteur":"Gamma Land","promoteurKey":"gamma land","promoteurFull":"Gamma Land-460 8000","contactName":"","phone":"460 8000","units":"38 units","unitDetails":"38 units- 22(2 beds)10.8, 16(3 beds)14m","amenities":"Landscape courtyard, gym, lounge","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Syndic fee quoted at 6500-7000","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"33","projectName":"Coastland Appartements","location":"Pereybere","promoteur":"Coastland Ltd","promoteurKey":"coastland","promoteurFull":"Coastland Ltd-5481 3842-Project consultant Arjuna Papiah- commercialisation","contactName":"","phone":"5481 3842","units":"35 units","unitDetails":"35 units-18(2 beds)17.8, 14(3 beds)19.3, 3(pent)27.5m","amenities":"Pool, generator,garden, parking, lift","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"34","projectName":"Terre d'Été","location":"La Joliette Smart City","promoteur":"Apavou Group","promoteurKey":"apavou","promoteurFull":"Apavou Group- 460 5555","contactName":"Deepak","phone":"5758 7167","units":"20 units","unitDetails":"2 block with 20 apts each","amenities":"24/7 security and controlled access, parking, garden, common space","projectStage":"Near Delivery","pipelineStage":"Prospecting","priority":"High","notes":"delivery April to mid 2026\n---\nCall activity: 14/04/26-spoke to Mme Khristee- gave me num of Deepak-57587167 and Rekha(in charge of sales)-57510307. Got Mr Deepak- Meeting Wed 22/04/26 at 10h- Cube building(next or across silverbank building)","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"35","projectName":"West Coast","location":"Albion","promoteur":"Exclusive Albion Villas ltd, Christian Lafraisiere- project director","promoteurKey":"exclusive albion","promoteurFull":"Exclusive Albion Villas ltd, Christian Lafraisiere- project director-5289 3235/5761 4778/5250 1220","contactName":"","phone":"5289 3235","units":"25 units","unitDetails":"Part 1- 25 villas(PDS development), Part 2- albion gated Residence- 40 plots(45k per toise, 7.6 starting)","amenities":"Clubhouse(1080m2), roads","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"36","projectName":"La Salette Estate","location":"Grand Baie","promoteur":"Maxcity Group","promoteurKey":"maxcity","promoteurFull":"Maxcity Group","contactName":"","phone":"","units":"42 arpents-","unitDetails":"42 arpents-","amenities":"Involves large central gardens and future projects in same area, more htan 8,888m2 of common green space","projectStage":"Permitting & Planning","pipelineStage":"Prospecting","priority":"Cold","notes":"needs prep as it is a big group- not sure if copropriete","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"37","projectName":"Blue Vista","location":"Plantation Marguery, Black River","promoteur":"Flowproperties- Samuel merier d'unieville and Alice- both founders","promoteurKey":"flowproperties","promoteurFull":"Flowproperties- Samuel merier d'unieville and Alice- both founders","contactName":"","phone":"","units":"10 units","unitDetails":"10 units-4 villas, 2 pents, 4 appartements","amenities":"","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Within plantaiton marguery- to see if a syndic is already inn charge. Normally works with The Smart Syndic, gave testimony on TSS site that all their properties are managed by TSS- showed some loyalty","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"38","projectName":"Palmaris Villas","location":"Domain Palmyre, Rivière Noire","promoteur":"Flowproperties- Samuel merier d'unieville and Alice- both founders","promoteurKey":"flowproperties","promoteurFull":"Flowproperties- Samuel merier d'unieville and Alice- both founders","contactName":"","phone":"","units":"16 units","unitDetails":"16 units- 16 villas(3 to 4 beds) each with private pool, 1.66 hectare gated","amenities":"Clubhouse, gym, lounge, infinity pool, bbq area, 24/7 illuminated pathways, green spaces","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Normally works with The Smart Syndic, gave testimony on TSS site that all their properties are managed by TSS- show some loyalty","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"39","projectName":"Ocean's Pearl","location":"La Tourelle, Tamarin","promoteur":"Anjo Realty Ltd(seems to be an SPV)","promoteurKey":"anjo","promoteurFull":"Anjo Realty Ltd(seems to be an SPV)","contactName":"","phone":"","units":"18 units","unitDetails":"18 units- 3 buildings. 6 units per buildings. Gorund floor 3 beds appartements with private pool(19m), first floor-3 beds(23m), second floor- 3 beds(panoramic view+ option for rooftop pool)(40m)","amenities":"28 parking, lush tropical garden, private lift for each building with direct access to parking, no shared pool","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"15/04/26- anjo realty is engle and volker, admin(forgot her name- next time to remember, she was helpful- gave me Mme Isabel Weber num 57833001 for this project. The project is still in development.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"40","projectName":"AZULINA Resort & Residences","location":"Grande Pointe aux Piments / Pointe aux Biches","promoteur":"No partiular detail on the promoteur, however has a dedicted site- azulina-mauritius.com","promoteurKey":"azulina","promoteurFull":"No partiular detail on the promoteur, however has a dedicted site- azulina-mauritius.com and crealys.mu- contact: 5788 0342","contactName":"Mr Alimamode","phone":"5788 0342","units":"28 units","unitDetails":"28 units(2 buildings)- 24 apts(3 beds)17.9, 4(Pents of 3 beds)37.5 to 40m","amenities":"2 large common pool, gym, boma area, tropical landscaping, common garden","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"High","notes":"The project is self-funded, delivery set june 2026.\n---\nCall activity: 15/04/26 call num- no answer. Got Mr Alimamode- Meeting Jeudi 23/04/26 at 10h on site of Azulina. Potential coordinates-20°03'18.51\"S 57°31'20.07\"E","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"41","projectName":"Kaela Villas III","location":"Cap Malheureux","promoteur":"Promoteur: Deepak Doolooa, Director of RDCL (RD Construction Ltd)","promoteurKey":"rdcl","promoteurFull":"Promoteur: Deepak Doolooa, Director of RDCL (RD Construction Ltd) Contact: +230 5250 4401 | info@rdcl.mu | kaelavillas.com","contactName":"+230 5250 4401","phone":"+230 5250 4401","units":"18 units","unitDetails":"18 villas(6 types) depending on type prices range from 12.2 to 21.5 m","amenities":"Gated community, lush tropical landscaping. No shared pool or gym mentioned publicly. This is the key unknown","projectStage":"Finishing Works","pipelineStage":"Prospecting","priority":"Warm","notes":"Deepak is a first-generation developer scaling fast (2 villas → 5 → 18)\n---\nCall activity: 15/04/26- got  Doolooa- he leaves the country tomorrow, be back first week of May, call him back 11/05/26- to set a meeting- the project is under construction.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"42","projectName":"Blue Rock Residence","location":"Green Creek Estate, Flic en Flac","promoteur":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo","promoteurKey":"robin ramiah","promoteurFull":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo, 5815 9000, Jeannot Thomas, Directeur Commercial","contactName":"","phone":"5815 9000","units":"33 units","unitDetails":"33 apts- ground floor, first floors and rooftop","amenities":"Pool(20x4), kids pool(6x3), common tank(35000l), parking bay, garden, cctv, generator, water features, bin area, uncovered parking 43","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"Indicated mise hors d'eau reached in Aug 2024 and delivery dec 2025, however still on their site as ongoing, maybe delayed","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"43","projectName":"Sunset Walk Residence","location":"Flic en Flac","promoteur":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo","promoteurKey":"robin ramiah","promoteurFull":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo, 5815 9000, Jeannot Thomas, Directeur Commercial","contactName":"","phone":"5815 9000","units":"39 units","unitDetails":"39 apts-6 basement, 11 goundfloors, 11 first floors, 11 rooftops- 15m to 16 m for rooftops, lowerground floor 6.8 m","amenities":"18m pool with kids pool, water tank(36000l), parking bay, garden, cctv, generator, water feature, bin area","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"mise hors d'eau oct 2025, 3rd payment march 2026, 4th payment august 2026, delivery dec 2026, construction at 65%","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"44","projectName":"Park West Residence","location":"Uniciti","promoteur":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo","promoteurKey":"robin ramiah","promoteurFull":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo, 5815 9000, Jeannot Thomas, Directeur Commercial","contactName":"","phone":"5815 9000","units":"116 units","unitDetails":"116 apt","amenities":"","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Project announced only, to check for ongoing projects above may then get these contracts too","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"45","projectName":"Aureya & Mireva","location":"Albion","promoteur":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo","promoteurKey":"robin ramiah","promoteurFull":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo, 5815 9000, Jeannot Thomas, Directeur Commercial","contactName":"","phone":"5815 9000","units":"","unitDetails":"","amenities":"","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Project announced only, to check for ongoing projects above may then get these contracts too. This is their first project out of Flic en Flac","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"46","projectName":"The One","location":"","promoteur":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo","promoteurKey":"robin ramiah","promoteurFull":"Robin Ramiah Properties Ltd- Robin Ramiah, director and ceo, 5815 9000, Jeannot Thomas, Directeur Commercial","contactName":"","phone":"5815 9000","units":"","unitDetails":"","amenities":"","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Project announced only, to check for ongoing projects above may then get these contracts too. This is their first smart city project","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"47","projectName":"Luma by Islanova","location":"grand baie","promoteur":"Unknown- did not find Islanova o cbris, marketed by agency Claudia Morris Real E","promoteurKey":"unknown-islanova","promoteurFull":"Unknown- did not find Islanova o cbris, marketed by agency Claudia Morris Real Estate Mauritius","contactName":"","phone":"","units":"no particuar details, consist of 1(4.25-","unitDetails":"no particuar details, consist of 1(4.25-5.25) and 2(5.75-6.75) bedrooms.(49m2-100m2)","amenities":"Rooftop infinity swimming pool, bar, Rooftop fitness studio, Lift, resident parking","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Just off vefa, no details for the projecct, only images. Claudia Morris Num 5723 3469","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"48","projectName":"Quatre-Bornes Appartements","location":"Quatre-Bornes","promoteur":"Terrex Properties(small promoteur)","promoteurKey":"terrex","promoteurFull":"Terrex Properties(small promoteur)-5857 0717","contactName":"","phone":"5857 0717","units":"no particular detail on composition- pri","unitDetails":"no particular detail on composition- prices from 6.8 to 7.5m","amenities":"Lift, covered parking, gated, yard, automated gate","projectStage":"Finishing Works","pipelineStage":"Prospecting","priority":"Cold","notes":"Delivery stated for 2026 without additional precision. Verification for number of units etc on call, no particular details","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"49","projectName":"Le Courtyard residences","location":"trou aux biches/mont choisy","promoteur":"Blackobsidian group. Founder: Dhashween Bhogun","promoteurKey":"blackobsidian","promoteurFull":"Blackobsidian group. Founder: Dhashween Bhogun — finance background (CIEL Finance / IPRO, PwC Deals Advisory, GRIT Real Estate). Contact: dhash@blackobsidian.group / +230 5257 5707","contactName":"dhash@blackobsidian.group","phone":"+230 5257 5707","units":"Duplex project-143m2-3 beds- price 16m- ","unitDetails":"Duplex project-143m2-3 beds- price 16m- no unit count yet","amenities":"Gated, 24/7 security, private entrance","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"They mentioned on their site they work with people with at least 5 years in their field.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"50","projectName":"Medine Smart City Projects","location":"Vêtivier / Frangipanier / Bois de Chandelle","promoteur":"Medine","promoteurKey":"medine","promoteurFull":"Medine-452 9293- Nicolas Michael Dhootun = Sales & Leasing Officer","contactName":"","phone":"452 9293","units":"70 units","unitDetails":"Frangipanier-70 apartments-started july 2024, delivery scheduled for late 2026. Bois de chandelle-34 townhouses-22 three-bedroom and 2 four-bedroom units, with private gardens, from 165m²-21.5m, delivery schedule 2028","amenities":"","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"The pahse 1 is stated to have been delivered in feb 2025. normally works with The Smart Syndic","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"51","projectName":"Le Havre","location":"Pointe aux piments(opposite Le Méridien Hotel)","promoteur":"GP properties-First known PDS project.","promoteurKey":"gp","promoteurFull":"GP properties-First known PDS project. Contact: +230 54 50 05 03 / +230 54 22 11 87 | sales@gpgroup.mu","contactName":"+230 54 50 05 03","phone":"+230 54 50 05 03","units":"15 units","unitDetails":"15 villas(3 beds-bedroom ensuite, each with private pool)","amenities":"shared restaurant, gardens, gate, paths","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"52","projectName":"Unknown Project Trou aux Biches","location":"Trou aux Biches","promoteur":"unknown-marketed via \"French immo consulting\" agency.","promoteurKey":"unknown-french","promoteurFull":"unknown-marketed via \"French immo consulting\" agency.","contactName":"","phone":"","units":"18 units","unitDetails":"18 villas vefa","amenities":"","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"53","projectName":"Tamarin Living","location":"Tamarin","promoteur":"Promoteur: Unknown — marketed via OME Mauritius, Park Lane, Sotheby's.","promoteurKey":"ome-tamarin","promoteurFull":"Promoteur: Unknown — marketed via OME Mauritius, Park Lane, Sotheby's. Jennifer Hirst (Sotheby's) +230 5492 8506","contactName":"","phone":"+230 5492 8506","units":"15 units","unitDetails":"15 units-8x3-bed flats, 4x4-bed flats, 3 penthouses (private pools) — 3 buildings, 8,000m² beachfront estate","amenities":"Common pool, 24/7 security, parking, landscaped garden, direct beach","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Delivery: Unknown — off-plan listings active as of 2024","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"54","projectName":"Bayside Waterfront Residences","location":"Kapu Kai, Grand Baie","promoteur":"Promoteur: Unknown — marketed exclusively via Pam Golding, Barnes, Sotheby's, RE/MAX 24","promoteurKey":"bayside","promoteurFull":"Promoteur: Unknown — marketed exclusively via Pam Golding, Barnes, Sotheby's, RE/MAX 24. Zaheer — +230 5854 9877 (from bayside.mu/contact)","contactName":"","phone":"+230 5854 9877","units":"15 units","unitDetails":"15 units-12 apartments (2 & 3-bed) + 3 penthouses (private pools)","amenities":"Olympic-sized pool, boathouse/marina, pool lounge, tropical garden, parking, security post, direct bay access","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"55","projectName":"Paille en Queue 2","location":"","promoteur":"Dil Property Development Ltd","promoteurKey":"dil","promoteurFull":"Dil Property Development Ltd — small Mauritian independent, previous PDS/G+2 track record","contactName":"","phone":"","units":"","unitDetails":"","amenities":"","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"Phase 1 delivered 2022-may have a syndic. Unable to find Dil p.d number after a google search","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"56","projectName":"The Riverfield","location":"Palmerstone Road, Vacoas-Phoenix","promoteur":"Resvic","promoteurKey":"resvic","promoteurFull":"Resvic-230 5924 3245 or email sales.resvic@gmail.com. Check on cbris, reveals maybe they look after the syndic themselves- to try as massive project","contactName":"","phone":"230 5924 3245","units":"81 units","unitDetails":"81 units-1-bed (50m²) to 4-bed (160m²) + penthouses- 2 beds start 7m","amenities":"24/7security+gate post, equipped gym, lobby/reception, lounge, lift to 6th floor, 1 parking per apartement","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"Delivery end 2027, but project has started since 2023-2024","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"57","projectName":"Orêava Residences-Piton","location":"Piton","promoteur":"B17 development-kelly rae d'argent(found on linkedin)","promoteurKey":"b17","promoteurFull":"B17 development-kelly rae d'argent(found on linkedin)","contactName":"","phone":"","units":"39 units","unitDetails":"39 apartments-12.7M → 35.4M-2-bed (100–138m²) · 3-bed (122–176m²) · Penthouses (183–273m²)","amenities":"Basement parking · storerooms · standby generator · lift · security","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"unknown delivery- maybe still off plan","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"58","projectName":"Aux Portes du Rempart","location":"Cascavelle, Black River","promoteur":"Aux Portes du Rempart Ltd — William Garcia (Réunion-based)","promoteurKey":"aux portes","promoteurFull":"Aux Portes du Rempart Ltd — William Garcia (Réunion-based) Phone: +230 5791 6099 / +262 693 936693 Email: wgarcia@cba.re","contactName":"William Garcia","phone":"5791 6099","units":"12 units","unitDetails":"12 villas total — all 4 beds, 5 bathrooms (incl. outdoor shower). Type A: concrete, garden+pool views toward ocean/sunset. Type B: metal frame (Housinnovation), Montagne du Rempart views. 8/12 villas built end-2025. 2 parking per villa. No published pricing.","amenities":"Fully enclosed gated residence, electric gate, spa (sauna, hammam, cold bath, treatment cabins), high-end gym, padel court, 6,000m² permaculture food garden, common area lighting+maintenance","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Top Priority","notes":"Pre-delivery window open. Syndic not named in règlement yet. Delivery Sep 2026.\n⚠️ TOP PRIORITY — pre-delivery window open. Full delivery September 2026. Syndic not named in règlement yet. Approach before règlement finalised. PDS Certificate.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"59","projectName":"Le Savoy","location":"Pointe aux Canonniers","promoteur":"Samudra Ltd — Extra Dimension Group (South African developer), built by REHM Grinaker","promoteurKey":"samudra","promoteurFull":"Samudra Ltd — Extra Dimension Group (South African developer), built by REHM Grinaker. Contact: Shaun Anthony Toweel stoweel@gmail.com Phone: +230 467 8684","contactName":"Shaun Toweel","phone":"467 8684","units":"42 units","unitDetails":"42 units: 12x2-bed apts (172m²), 16x3-bed apts (172m²), 14 penthouses (sea views). Each unit: private pool (optional), large covered veranda, parking. Pricing: from €520,500 to €1,098,125.","amenities":"Common wellness centre, 24hr security, card-controlled access, fibre optic, parking, fully managed boatyard/boating access","projectStage":"Delivered & Occupied","pipelineStage":"Prospecting","priority":"Top Priority","notes":"⚠️ URGENT — delivered project. Park Lane listing states 'Professional syndic will manage all common areas'. Syndic appointment status UNCONFIRMED. Verify immediately. PDS Certificate.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"60","projectName":"North Islands View","location":"Grand Gaube","promoteur":"North Islands View Ltd — Mr. Eric Andre Guenzi","promoteurKey":"north islands","promoteurFull":"North Islands View Ltd — Mr. Eric Andre Guenzi Email: guenzi.eric@orange.fr Phone: +230 5257 0977","contactName":"Mr. Eric Andre Guenzi","phone":"+230 5257 0977","units":"35 units","unitDetails":"35 units: 20x3-bed apts (170.7m², grd+1st floor), 5x4-bed penthouses (412m², private infinity pool+elevator), 10x4-bed garden houses (225.25m², 2 levels, private pool+garden). Pricing: apts from €449,000 | garden houses from €510,000 | penthouses from €1,265,000 | Rs 18.8M.","amenities":"2 infinity swimming pools, clubhouse, gym, green spaces, sea access, generator, solar water heater, watchman, lift","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"High","notes":"HIGH — 35 units, strong copropriété profile, independent developer. Website down but listed as under construction (Villa Vie agency). PDS Certificate.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"61","projectName":"Montana Oceano Vistas","location":"Domaine Palmyre, Black River","promoteur":"Montana Oceano Vistas Ltd — Ravin Bholah & Ashwin Hardas","promoteurKey":"montana","promoteurFull":"Montana Oceano Vistas Ltd — Ravin Bholah & Ashwin Hardas Email: ravin.ashwin@montanaoceano.com Phone: +230 5857 9902 / +230 5250 4707","contactName":"","phone":"+230 5857 9902","units":"17 units","unitDetails":"17 units: Block A(4x3-bed apts + 1x3-bed pent w/study), Block B(4x3-bed apts + 1x3-bed pent), Block C(2x3-bed apts + 1x2-bed pent), 2x4-bed villas plain pied, 2x2-bed cottages. All units: 2 parking bays.","amenities":"Health club, secured access, elevated position with Trois Mamelles views","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"High","notes":"MEDIUM-HIGH — 17 units, boutique independent developer, rich unit mix. PDS Certificate. Under construction.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"62","projectName":"Naia Residences","location":"Grand Baie (Chemin Vingt Pieds)","promoteur":"Naia Property Development Ltd — Mr. Reza Jangeerkhan","promoteurKey":"naia","promoteurFull":"Naia Property Development Ltd — Mr. Reza Jangeerkhan Email: naiappl@gmail.com Phone: +230 54230423","contactName":"Mr. Reza Jangeerkhan","phone":"+230 54230423","units":"23 units","unitDetails":"23 villas (2 phases): Phase 1 — 17 villas (Type A, single-storey, 166m²), Phase 2 — 6 villas (Type B, ground+1st floor). Each villa: plots 370–415m², private garden + private pool, open-plan living. PDS scheme.","amenities":"Gated and secured, office space, spa (communal or per villa)","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 23 villas, active 2-phase marketing suggests pre-delivery. PDS Certificate. Independent boutique developer.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"63","projectName":"Blue Green Signature","location":"Tamarin","promoteur":"Blue Green Signature Co Ltd — Signature Development","promoteurKey":"blue green","promoteurFull":"Blue Green Signature Co Ltd — Signature Development Contact: Patrick Jean Goupille Email: info@signature-development.com Phone: +230 57 27 44 88","contactName":"Patrick Jean Goupille","phone":"+230 57 27 44 88","units":"25 units","unitDetails":"25 villas + recreational and social centre. No published pricing.","amenities":"Recreational and social centre","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 25 villas, PDS Certificate. Construction status unclear. Also pursuing Bois Chandelle Villas (Mont Choisy) — confirm if same entity to batch pitch.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"64","projectName":"Kahoona Ltee","location":"Grand Baie","promoteur":"Kahoona Ltee — Mr. Eric Panechou","promoteurKey":"kahoona","promoteurFull":"Kahoona Ltee — Mr. Eric Panechou Email: panechou@gmail.com Phone: +230 52511600","contactName":"Mr. Eric Panechou","phone":"+230 52511600","units":"26 units","unitDetails":"26 units (25 duplexes + 1 villa per Defimedia 2017; PDS description: 26 villas + sports centre). No published pricing.","amenities":"Sports centre, café, medical centre, offices (per Defimedia)","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 26 units, Grand Baie, PDS Certificate. Construction status unclear.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"65","projectName":"Holacanthus Royal Ltd","location":"La Mivoie, Black River","promoteur":"Holacanthus Royal Ltd — Ceri Ltee (also behind Villas Emera + RES 'Aventurine')","promoteurKey":"holacanthus","promoteurFull":"Holacanthus Royal Ltd — Ceri Ltee Contact: Amathulla Kurimbokus Email: a.kurimbokus@groupcenturion.com Phone: +230 454 7008","contactName":"Amathulla Kurimbokus","phone":"+230 454 7008","units":"21 units","unitDetails":"21 units: 15 villas + 4 apts + 2 penthouses + crèche + gym + lifestyle clubhouse. Described as seafront luxury.","amenities":"Gym, lifestyle clubhouse, crèche","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 21 units, Letter of Approval. PITCH TOGETHER WITH VILLAS EMERA — same developer (Ceri Ltee), one approach.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"66","projectName":"Le Domaine de Mahé (Arkita Ltd)","location":"La Salette, Grand Baie","promoteur":"Arkita Ltd — Thierry & Dayana Fitton","promoteurKey":"arkita","promoteurFull":"Arkita Ltd — Thierry & Dayana Fitton Email: thierry.fitton@gmail.com Phone: +230 59 19 35 63 / 5443 2230 Website: domaine-de-mahe.com","contactName":"","phone":"+230 59 19 35 63","units":"18 units","unitDetails":"18 villas (typologies: Domain Shanti Villas, Duo Shanti Villas, Moana Villas). Fully turnkey delivery.","amenities":"Fitness/wellness centre (from PDS), turnkey delivery","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 18 villas, PDS Certificate, website active. Boutique independent developer. Fitton personally manages sales.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"67","projectName":"My Immobilière Project Ltd","location":"Grand Baie","promoteur":"My Immobilière Project Ltd — My Group, Mr. Chandradeo Oomah (Nitish)","promoteurKey":"my group","promoteurFull":"My Immobilière Project Ltd — My Group, Mr. Chandradeo Oomah (Nitish) Email: nitish@mygroup.mu Phone: +230 263 1338 / 574 52003","contactName":"Mr. Chandradeo Oomah","phone":"+230 263 1338","units":"18 units","unitDetails":"18 villas with related amenities.","amenities":"Not detailed publicly","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 18 villas, Grand Baie/Pointe aux Canonniers, PDS Certificate. Construction/delivery status unknown.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"68","projectName":"Vivaco Ltd","location":"Grand Baie","promoteur":"Vivaco Ltd — Mr. S. Jaulim (Jaulim Plaza)","promoteurKey":"vivaco","promoteurFull":"Vivaco Ltd — Mr. S. Jaulim (Jaulim Plaza) Email: jaulimplaza@intnet.mu Phone: +230 698 4136 / 5254 8620. NOTE: Same developer as Molinea Property Ltd (25 units Grand Baie, under construction). Pitch both in one approach.","contactName":"","phone":"+230 698 4136","units":"30 units","unitDetails":"30 villas + gym + spa + kids area. PDS Certificate.","amenities":"Gym, spa, kids area","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 30 villas. BATCH WITH MOLINEA PROPERTY (same contact Jaulim). Serial developer, 2 PDS projects. Verify delivery status before outreach.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"69","projectName":"Robertson Promotion Ltd","location":"Riviere du Rempart","promoteur":"Robertson Promotion Ltd — G.R. Patrimoine (Réunion-based real estate group)","promoteurKey":"robertson","promoteurFull":"Robertson Promotion Ltd — G.R. Patrimoine (Réunion-based real estate group) Contact: Mr. Stephane Robert Email: Stephane.grpatrimoine@gmail.com Phone: +230 5251 8374 / +230 5754 2050","contactName":"Mr. Stephane Robert","phone":"+230 5251 8374","units":"16 units","unitDetails":"16 villas + medical center + office spaces + sport and leisure facilities. PDS Certificate.","amenities":"Medical centre, office spaces, sport and leisure facilities","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 16 villas with strong amenity mix including medical centre. PDS Certificate. Réunion-based promoteur.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"70","projectName":"Zami Property Development","location":"Mare Seche, Grand Baie","promoteur":"Zami Property Development Ltd — Directors: Gaetan Willy Victor Paquay / Shaheel Dilloo","promoteurKey":"zami","promoteurFull":"Zami Property Development Ltd — Directors: Gaetan Willy Victor Paquay / Shaheel Dilloo Email: contact@villaszami.com Phone: +230 267 1946","contactName":"","phone":"+230 267 1946","units":"14 units","unitDetails":"14 villas + offices + gym. PDS Certificate.","amenities":"Offices, gym","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 14 villas, Mare Seche/Grand Baie, PDS Certificate. Confirm construction status.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"71","projectName":"Le Domaine de Mont Mascal","location":"Riviere du Rempart","promoteur":"Le Domaine de Mont Mascal Ltd — actual promoteur unknown","promoteurKey":"mont mascal","promoteurFull":"Le Domaine de Mont Mascal Ltd — actual promoteur unknown. Nicolas Gayraud (nicolas@nicoptik.com) listed as PDS contact — likely agent/notaire only. Identify actual promoteur via CBRIS before outreach.","contactName":"","phone":"","units":"17 units","unitDetails":"17 villas + gym. PDS Certificate.","amenities":"Gym","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Top Priority","notes":"MEDIUM — 17 villas, PDS Certificate. ⚠️ Identify actual promoteur via CBRIS lookup for Le Domaine de Mont Mascal Ltd before any outreach.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"72","projectName":"Amala Villas Ltd","location":"Trou aux Biches","promoteur":"Amala Villas Ltd — Mr. Manoj Jaynuth","promoteurKey":"amala","promoteurFull":"Amala Villas Ltd — Mr. Manoj Jaynuth Email: manoj@islandresidences.com Phone: +230 256 5938 / 265 8984","contactName":"Mr. Manoj Jaynuth","phone":"+230 256 5938","units":"28 units","unitDetails":"28 units: 24 apartments + 4 penthouses + shops + leisure. PDS Certificate.","amenities":"Shops, leisure facilities","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 28 units, PDS Certificate. Status unclear. Distinct entity from Jimei/amalavillas.net (delivered, excluded).","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"73","projectName":"Villas Emera Ltee","location":"Mont Choisy","promoteur":"Villas Emera Ltee — Ceri Ltee (same as Holacanthus Royal)","promoteurKey":"holacanthus","promoteurFull":"Villas Emera Ltee — Ceri Ltee (same as Holacanthus Royal) Contact: Cyrille Ennequin Email: c.ennequin@groupe-dhec.com Phone: +230 52511684 / 52542272","contactName":"Cyrille Ennequin","phone":"+230 52511684","units":"11 units","unitDetails":"11 villas (2-storey) + indoor golf simulator track + gymnasium. PDS Certificate.","amenities":"Indoor golf simulator track, gymnasium","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"MEDIUM — 11 villas, Mont Choisy. PITCH TOGETHER WITH HOLACANTHUS ROYAL — same developer Ceri Ltee, single approach via a.kurimbokus@groupcenturion.com.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"74","projectName":"Oceana Luxury Villas Ltd","location":"Grand Baie","promoteur":"Oceana Luxury Villas Ltd — Mr. Zakir Hussein Hosenbux","promoteurKey":"oceana luxury","promoteurFull":"Oceana Luxury Villas Ltd — Mr. Zakir Hussein Hosenbux Email: zakir@oceanaluxuryvillas.com Phone: +230 52573339","contactName":"Mr. Zakir Hussein Hosenbux","phone":"+230 52573339","units":"11 units","unitDetails":"11 villas + wellness space. Letter of Approval only.","amenities":"Wellness space","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"INBOUND ONLY — 11 villas, Grand Baie, Letter of Approval. Likely early-stage or stalled.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"75","projectName":"Tropica View Limited","location":"Grand Baie","promoteur":"Tropica View Limited — Mr. S. Nundlall / Mr. P. Ebizet","promoteurKey":"tropica","promoteurFull":"Tropica View Limited — Mr. S. Nundlall / Mr. P. Ebizet Email: patrick.ebizet@gmail.com Phone: +230 242 2014 / +230 52523407","contactName":"","phone":"+230 242 2014","units":"19 units","unitDetails":"19 villas + kindergarten. PDS Certificate.","amenities":"Kindergarten (unusual — family-oriented community)","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"INBOUND ONLY — 19 villas, Grand Baie. PDS Certificate. No marketing activity found.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"76","projectName":"Skanda Property Development (Keon Properties)","location":"Mare Seche, Grand Baie","promoteur":"Skanda Property Development Ltd — Keon Properties","promoteurKey":"skanda","promoteurFull":"Skanda Property Development Ltd — Keon Properties Contact: Mr. Selven Warden / Mrs. Dhana Warden Email: dhana@keonproperties.com Phone: +230 2139563 / 5940 1212","contactName":"Mr. Selven Warden","phone":"+230 2139563","units":"12 units","unitDetails":"12 villas + gym + recreational area. Letter of Approval only.","amenities":"Gym, recreational area","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"INBOUND ONLY — 12 villas, Mare Seche/Grand Baie, Letter of Approval. Independent family developer (Keon Properties).","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"77","projectName":"Sileview Residence Ltd","location":"Tamarin heights","promoteur":"Sileview Residence Ltd — Mr. R. Ramlackhan","promoteurKey":"sileview","promoteurFull":"Sileview Residence Ltd — Mr. R. Ramlackhan Email: rhoy@broll-io.com Phone: +230 5729 8822. Marketed by: Westimmo / Stone Investment / Sotheby's / RE/MAX 24","contactName":"","phone":"+230 5729 8822","units":"12 units","unitDetails":"12 units: 4x2-bed apts (155m², from €488,000), 2x3-bed duplexes (292m², €992,000, private pool+garden), 2x4-bed penthouses (404m², €1,875,000, rooftop infinity pool). 180° sea view. PDS scheme.","amenities":"2 central elevator blocks, panoramic sea views, private pools per duplex and penthouse","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"SMALL/INBOUND ONLY — 12 units, heights of Tamarin. High-end project. PDS Certificate. Verify delivery status — marketing still active on portals.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"78","projectName":"Ki Signature Villas Ltd","location":"Pereybere","promoteur":"Ki Signature Villas Ltd — Mr. Koosraj Ramanah","promoteurKey":"ki signature","promoteurFull":"Ki Signature Villas Ltd — Mr. Koosraj Ramanah Email: info@vagrouplimited.com Phone: +230 52515304","contactName":"Mr. Koosraj Ramanah","phone":"+230 52515304","units":"6 units","unitDetails":"6 villas + clubhouse. PDS Certificate.","amenities":"Clubhouse","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"SMALL/INBOUND ONLY — 6 villas, Pereybere, PDS Certificate.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"79","projectName":"Maudepro Ltee","location":"Mare Seche, Grand Baie","promoteur":"Maudepro Ltee — Mr. Pierre Henri Sprang","promoteurKey":"maudepro","promoteurFull":"Maudepro Ltee — Mr. Pierre Henri Sprang Email: maudepro1@gmail.com","contactName":"Mr. Pierre Henri Sprang","phone":"","units":"8 units","unitDetails":"8 villas + wellness centre. PDS Certificate.","amenities":"Wellness centre","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"SMALL/INBOUND ONLY — 8 villas, Mare Seche/Grand Baie, PDS Certificate.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"80","projectName":"Le Clos du Littoral Phase III","location":"Tamarin","promoteur":"Le Clos du Littoral Phase III Ltd — Mr. Amedee Maingard","promoteurKey":"clos du lit","promoteurFull":"Le Clos du Littoral Phase III Ltd — Mr. Amedee Maingard Email: amedee@lamivoie.com Phone: +230 5 738 2117","contactName":"Mr. Amedee Maingard","phone":"+230 5 738 2117","units":"7 units","unitDetails":"7 villas at Le Ruisseau Creole commercial complex. Letter of Approval. Phase III of ongoing development.","amenities":"Access to Le Ruisseau Creole commercial facilities (restaurant, spa etc.)","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"SMALL/INBOUND ONLY — 7 villas, Letter of Approval. Linked to Le Ruisseau Creole commercial complex, Tamarin.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"81","projectName":"Blue Ocean (Mauritius) Properties Ltd","location":"Tamarin","promoteur":"Blue Ocean (Mauritius) Properties Ltd — Mr. Suburaay Crustna","promoteurKey":"blue ocean","promoteurFull":"Blue Ocean (Mauritius) Properties Ltd — Mr. Suburaay Crustna Email: suburaay@luxeliving.mu Phone: +230 58163353","contactName":"Mr. Suburaay Crustna","phone":"+230 58163353","units":"7 units","unitDetails":"7 villas + gym. PDS Certificate.","amenities":"Gym","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"SMALL/INBOUND ONLY — 7 villas, Tamarin, PDS Certificate. Same contact as Paradise Palm Ltd (6 villas, also Tamarin) — same promoteur, could pitch both.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"82","projectName":"Caldera Developments Ltd","location":"Tamarin","promoteur":"Caldera Developments Ltd — Mr. Adriaan Louw","promoteurKey":"caldera","promoteurFull":"Caldera Developments Ltd — Mr. Adriaan Louw Email: Adriaan@caldera.mu Phone: +230 5804 1501","contactName":"Mr. Adriaan Louw","phone":"+230 5804 1501","units":"7 units","unitDetails":"7 villas + wellness centre. Letter of Approval.","amenities":"Wellness centre","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"SMALL/INBOUND ONLY — 7 villas, Tamarin, Letter of Approval.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"83","projectName":"Las Palmas Ltd","location":"Domaine des Terminalia, Tamarin","promoteur":"Las Palmas Ltd — Mr. Jerome Giblot Ducray","promoteurKey":"las palmas","promoteurFull":"Las Palmas Ltd — Mr. Jerome Giblot Ducray Email: jerome@unfold.mu Phone: +230 59413718","contactName":"Mr. Jerome Giblot Ducray","phone":"+230 59413718","units":"8 units","unitDetails":"8 villas + wellness centre + eco park. PDS Certificate.","amenities":"Wellness centre, eco park","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"SMALL/INBOUND ONLY — 8 villas, Domaine des Terminalia, Tamarin, PDS Certificate.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"84","projectName":"Botanic Bay","location":"Grand Baie","promoteur":"Unknown promoteur- agent Rawson properties","promoteurKey":"botanic bay","promoteurFull":"Unknown promoteur- agent Rawson properties-chanda.fayolle@rawson.mu / julie.granger@rawson.mu / nadine.boudan@rawson.mu — phones: +230 5500 4968 / +230 5258 9921 / +230 5258 4084. The Hub real estate-5252 5084","contactName":"","phone":"+230 5500 4968","units":"15 units","unitDetails":"15 units- 12 apartements and 3 penthouses-15 total: 6x Type 1 (140.4m², 3-bed, €490k) + 6x Type 2 (143.1m², 3-bed, €490k) + 3x penthouses (234.7m², €690k)","amenities":"6,730m² (exceptionally large for Grand Baie); only 20% built. Lagoon-style pool, vast landscaped garden, parking, backup generator, security, lift, automatic gate, Italian kitchen","projectStage":"Near Delivery","pipelineStage":"Prospecting","priority":"High","notes":"delivery end 2026","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"85","projectName":"Atlantis 2","location":"La Salette, Grand Baie","promoteur":"Promoteur: My Group (mygroup.mu)","promoteurKey":"my group","promoteurFull":"Promoteur: My Group (mygroup.mu) — independent Mauritian-owned group. Owner/CEO: Josian Deelawon. Contact: 263 1340 Email: info@mygroup.mu","contactName":"263 1340","phone":"263 1340","units":"18 units","unitDetails":"18 villas — 3BR and 4BR, each with private pool. Villa Prestige — 3BR/3BA, 271m² built / 454m² total — from 30m. Villa Signature — 3BR/3BA, 312m² built / 653m² total — from 45m. Villa Exclusive — 4BR/4BA, 344m² built / 722m² total — from 45m","amenities":"Spa, fitness centre, gated access, electric gate, security","projectStage":"Under Construction","pipelineStage":"Prospecting","priority":"Cold","notes":"pictures updated march 2026- construction going on. They mention on their site that they take on post management (syndic) for good transition namely in the first year. This may be an opening(offloading for them maybe an entry point.","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
  {"id":"86","projectName":"Atlantis 3","location":"","promoteur":"promoteur: My group","promoteurKey":"my group","promoteurFull":"promoteur: My group","contactName":"","phone":"","units":"","unitDetails":"","amenities":"","projectStage":"Pre-Launch/Off-Plan","pipelineStage":"Prospecting","priority":"Cold","notes":"","callLog":[],"nextFollowUp":"","createdAt":"2026-04-16"},
];

// ── UI Components (unchanged from original) ───────────────────────────────────
function Badge(props) {
  return (
    <span style={{
      display:"inline-block", padding:"2px 8px", borderRadius:99, fontSize:11,
      fontWeight:600, background:props.bg+"22", color:props.bg, border:"1px solid "+props.bg+"44"
    }}>{props.label}</span>
  );
}

function Fld(props) {
  var s = { display:"flex", flexDirection:"column", gap:4, marginBottom:14 };
  var ls = { fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600 };
  var inp = {
    background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"8px 10px",
    color:CREAM, fontSize:13, outline:"none", width:"100%", boxSizing:"border-box"
  };
  if (props.type === "select") {
    return (
      <div style={s}>
        <label style={ls}>{props.label}</label>
        <select value={props.value} onChange={function(e){props.onChange(e.target.value);}} style={inp}>
          {props.options.map(function(o){ return <option key={o} value={o}>{o}</option>; })}
        </select>
      </div>
    );
  }
  if (props.type === "textarea") {
    return (
      <div style={s}>
        <label style={ls}>{props.label}</label>
        <textarea value={props.value} onChange={function(e){props.onChange(e.target.value);}}
          rows={3} style={{...inp, resize:"vertical"}}/>
      </div>
    );
  }
  return (
    <div style={s}>
      <label style={ls}>{props.label}</label>
      <input type={props.type||"text"} value={props.value}
        onChange={function(e){props.onChange(e.target.value);}} style={inp}/>
    </div>
  );
}


function RegionEditModal(props) {
  var [list, setList] = useState(props.regions.slice());
  var [newVal, setNewVal] = useState("");
  function add() {
    var v = newVal.trim();
    if (!v || list.includes(v)) return;
    setList(list.concat(v));
    setNewVal("");
  }
  function remove(i) { setList(list.filter(function(_,j){ return j!==i; })); }
  function save() { props.onSave(list); }
  var ovl = { position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center" };
  var sht = { background:CARD, border:"1px solid "+BORDER, borderRadius:12, width:"86%", maxWidth:380, padding:24 };
  return (
    <div style={ovl} onClick={function(e){ if(e.target===e.currentTarget) props.onClose(); }}>
      <div style={sht}>
        <div style={{ color:GOLD, fontWeight:700, fontSize:15, marginBottom:16 }}>Edit Regions</div>
        {list.map(function(r, i) {
          return (
            <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 10px",
              background:CARD2, borderRadius:6, marginBottom:6, border:"1px solid "+BORDER }}>
              <span style={{ color:CREAM, fontSize:13 }}>{r}</span>
              <button onClick={function(){ remove(i); }}
                style={{ background:"none", border:"none", color:MUTED, cursor:"pointer", fontSize:16, lineHeight:1 }}>x</button>
            </div>
          );
        })}
        <div style={{ display:"flex", gap:8, marginTop:10 }}>
          <input value={newVal} onChange={function(e){ setNewVal(e.target.value); }}
            onKeyDown={function(e){ if(e.key==="Enter") add(); }}
            placeholder="New region..."
            style={{ flex:1, background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"7px 10px", color:CREAM, fontSize:13, outline:"none" }}/>
          <button onClick={add} style={{ padding:"7px 14px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700 }}>Add</button>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:16 }}>
          <button onClick={props.onClose} style={{ padding:"7px 16px", borderRadius:6, border:"1px solid "+BORDER, background:CARD2, color:CREAM, cursor:"pointer", fontSize:13 }}>Cancel</button>
          <button onClick={save} style={{ padding:"7px 16px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function EditForm(props) {
  var lead = props.lead;
  var set = props.setLead;
  function f(k) { return function(v){ set(function(p){ return {...p, [k]:v}; }); }; }
  var ovl = {
    position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000,
    display:"flex", alignItems:"center", justifyContent:"center"
  };
  var sht = {
    background:CARD, border:"1px solid "+BORDER, borderRadius:12, width:"92%",
    maxWidth:560, maxHeight:"92vh", display:"flex", flexDirection:"column", overflow:"hidden"
  };
  return (
    <div style={ovl} onClick={function(e){ if(e.target===e.currentTarget) props.onCancel(); }}>
      <div style={sht}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid "+BORDER, flexShrink:0, color:GOLD, fontWeight:700, fontSize:16 }}>
          Edit Project
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"20px" }}>
          <Fld label="Project Name" value={lead.projectName} onChange={f("projectName")}/>
          <Fld label="Location" value={lead.location} onChange={f("location")}/>
          <Fld label="Promoteur" value={lead.promoteur} onChange={f("promoteur")}/>
          <Fld label="Contact Name" value={lead.contactName} onChange={f("contactName")}/>
          <Fld label="Phone" value={lead.phone} onChange={f("phone")}/>
          <PhoneMatchInfo phone={lead.phone} leadId={lead.id} allLeads={props.allLeads||[]}/>
          {props.relatedCount > 0 && (
            <div
              onClick={function(){ props.setSyncContact(!props.syncContact); }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
                background:GOLD+"11", borderRadius:6, border:"1px solid "+GOLD+"33",
                marginBottom:14, cursor:"pointer" }}>
              <input type="checkbox" checked={props.syncContact} readOnly
                style={{ accentColor:GOLD, width:14, height:14, cursor:"pointer" }}/>
              <span style={{ fontSize:12, color:GOLD }}>
                Apply contact, phone &amp; notes to {props.relatedCount} other {lead.promoteur} project{props.relatedCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
          <Fld label="Units (total)" value={lead.units} onChange={f("units")}/>
          <Fld label="Unit Details" value={lead.unitDetails} onChange={f("unitDetails")} type="textarea"/>
          <Fld label="Amenities" value={lead.amenities} onChange={f("amenities")} type="textarea"/>
          <Fld label="Project Stage" value={lead.projectStage} onChange={f("projectStage")} type="select" options={PROJECT_STAGES}/>
          <Fld label="Pipeline Stage" value={lead.pipelineStage} onChange={f("pipelineStage")} type="select" options={PIPELINE_STAGES}/>
          <Fld label="Priority" value={lead.priority||""} onChange={f("priority")} type="select" options={[""].concat(PRIORITIES)}/>
          <Fld label="Next Follow-Up" value={lead.nextFollowUp} onChange={f("nextFollowUp")} type="date"/>
          <Fld label="Region" value={lead.region||""} onChange={f("region")} type="select" options={[""].concat(props.regions||DEFAULT_REGIONS)}/>
          <Fld label="GPS Coordinates" value={lead.gpsCoords||""} onChange={f("gpsCoords")}/>
          <Fld label="Notes" value={lead.notes} onChange={f("notes")} type="textarea"/>
        </div>
        <div style={{ padding:"14px 20px", borderTop:"1px solid "+BORDER, flexShrink:0, display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button style={{ padding:"8px 20px", borderRadius:6, border:"1px solid "+BORDER, background:CARD2, color:CREAM, cursor:"pointer", fontSize:13 }} onClick={props.onCancel}>Cancel</button>
          <button style={{ padding:"8px 20px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700 }} onClick={props.onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

function AddForm(props) {
  var blank = {
    projectName:"", location:"", promoteur:"", promoteurKey:"", promoteurFull:"",
    contactName:"", phone:"", units:"", unitDetails:"", amenities:"",
    projectStage:PROJECT_STAGES[0], pipelineStage:PIPELINE_STAGES[0],
    priority:"", notes:"", callLog:[], nextFollowUp:"", createdAt:"",
    region:"", gpsCoords:""
  };
  var [form, setForm] = useState(function(){ return Object.assign({}, blank, props.initial || {}); });
  var [formError, setFormError] = useState("");
  function f(k) { return function(v){ setForm(function(p){ return {...p,[k]:v}; }); }; }
  var ovl = { position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" };
  var sht = { background:CARD, border:"1px solid "+BORDER, borderRadius:12, width:"92%", maxWidth:560, maxHeight:"92vh", display:"flex", flexDirection:"column", overflow:"hidden" };
  function submit() {
    if (!form.projectName.trim()) {
      setFormError("Project Name is required — scroll up and give this lead a name.");
      return;
    }
    setFormError("");
    props.onAdd({...form, createdAt: new Date().toISOString().split("T")[0]});
  }
  return (
    <div style={ovl} onClick={function(e){ if(e.target===e.currentTarget) props.onCancel(); }}>
      <div style={sht}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid "+BORDER, flexShrink:0, color:GOLD, fontWeight:700, fontSize:16 }}>Add New Lead</div>
        <div style={{ flex:1, overflowY:"auto", padding:"20px" }}>
          <Fld label="Project Name *" value={form.projectName} onChange={f("projectName")}/>
          <Fld label="Location" value={form.location} onChange={f("location")}/>
          <Fld label="Promoteur" value={form.promoteur} onChange={f("promoteur")}/>
          <Fld label="Contact Name" value={form.contactName} onChange={f("contactName")}/>
          <Fld label="Phone" value={form.phone} onChange={f("phone")}/>
          <PhoneMatchInfo phone={form.phone} leadId={null} allLeads={props.allLeads||[]}/>
          <Fld label="Units (total)" value={form.units} onChange={f("units")}/>
          <Fld label="Unit Details" value={form.unitDetails} onChange={f("unitDetails")} type="textarea"/>
          <Fld label="Amenities" value={form.amenities} onChange={f("amenities")} type="textarea"/>
          <Fld label="Project Stage" value={form.projectStage} onChange={f("projectStage")} type="select" options={PROJECT_STAGES}/>
          <Fld label="Pipeline Stage" value={form.pipelineStage} onChange={f("pipelineStage")} type="select" options={PIPELINE_STAGES}/>
          <Fld label="Priority" value={form.priority||""} onChange={f("priority")} type="select" options={[""].concat(PRIORITIES)}/>
          <Fld label="Next Follow-Up" value={form.nextFollowUp} onChange={f("nextFollowUp")} type="date"/>
          <Fld label="Region" value={form.region||""} onChange={f("region")} type="select" options={[""].concat(props.regions||DEFAULT_REGIONS)}/>
          <Fld label="GPS Coordinates" value={form.gpsCoords||""} onChange={f("gpsCoords")}/>
          <Fld label="Notes" value={form.notes} onChange={f("notes")} type="textarea"/>
        </div>
        <div style={{ padding:"14px 20px", borderTop:"1px solid "+BORDER, flexShrink:0 }}>
          {formError && <div style={{ fontSize:12, color:"#ef4444", marginBottom:8, textAlign:"right" }}>{formError}</div>}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <button style={{ padding:"8px 20px", borderRadius:6, border:"1px solid "+BORDER, background:CARD2, color:CREAM, cursor:"pointer", fontSize:13 }} onClick={props.onCancel}>Cancel</button>
            <button style={{ padding:"8px 20px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700 }} onClick={submit}>Add Lead</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogEntryRow(props) {
  // One call/meeting log entry with inline edit + delete.
  var e = props.entry;
  var [editing, setEditing] = useState(false);
  var [eDate, setEDate] = useState(e.date || "");
  var [eNote, setENote] = useState(e.note || "");
  var color = props.color;
  if (editing) {
    return (
      <div style={{ marginBottom:10, padding:"8px 12px", background:CARD2, borderRadius:6, borderLeft:"3px solid "+color }}>
        <input type="date" value={eDate} onChange={function(ev){ setEDate(ev.target.value); }}
          style={{ background:INP, border:"1px solid "+BORDER, borderRadius:5, padding:"4px 8px", color:CREAM, fontSize:12, outline:"none", marginBottom:6 }}/>
        <textarea value={eNote} onChange={function(ev){ setENote(ev.target.value); }} rows={2}
          style={{ width:"100%", boxSizing:"border-box", background:INP, border:"1px solid "+BORDER, borderRadius:5, padding:"6px 8px", color:CREAM, fontSize:13, resize:"vertical" }}/>
        <div style={{ display:"flex", gap:6, justifyContent:"flex-end", marginTop:6 }}>
          <button onClick={function(){ setEditing(false); setEDate(e.date||""); setENote(e.note||""); }}
            style={{ padding:"4px 10px", borderRadius:5, border:"1px solid "+BORDER, background:"transparent", color:MUTED, cursor:"pointer", fontSize:11 }}>Cancel</button>
          <button onClick={function(){ if (!eNote.trim()) return; props.onEdit(e, { date: eDate || e.date, note: eNote.trim() }); setEditing(false); }}
            style={{ padding:"4px 12px", borderRadius:5, border:"none", background:color, color:"#fff", cursor:"pointer", fontSize:11, fontWeight:700 }}>Save</button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom:10, padding:"8px 12px", background:CARD2, borderRadius:6, borderLeft:"3px solid "+color }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
        <span style={{ fontSize:11, color:MUTED }}>{e.date}</span>
        <span style={{ display:"flex", gap:8 }}>
          <button title="Edit" onClick={function(){ setEditing(true); }}
            style={{ background:"none", border:"none", color:MUTED, cursor:"pointer", fontSize:13, padding:0 }}>✎</button>
          <button title="Delete" onClick={function(){ if (window.confirm("Delete this entry?")) props.onDelete(e); }}
            style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:13, padding:0 }}>✕</button>
        </span>
      </div>
      <div style={{ fontSize:13, color:CREAM, whiteSpace:"pre-wrap" }}>{e.note}</div>
    </div>
  );
}

function CallLogModal(props) {
  var lead = props.lead;
  var [note, setNote] = useState("");
  var allLeads = props.allLeads || [];
  var pKey = lead.promoteurKey;
  var promoteurCount = pKey && pKey.length > 2
    ? allLeads.filter(function(l){ return l.promoteurKey === pKey; }).length
    : 1;
  var ovl = { position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center" };
  var sht = { background:CARD, border:"1px solid "+BORDER, borderRadius:12, width:"90%", maxWidth:480, maxHeight:"80vh", display:"flex", flexDirection:"column" };
  function addNote() {
    if (!note.trim()) return;
    props.onAdd({ date: new Date().toISOString().split("T")[0], note: note.trim() });
    setNote("");
  }
  return (
    <div style={ovl} onClick={function(e){ if(e.target===e.currentTarget) props.onClose(); }}>
      <div style={sht}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid "+BORDER, color:GOLD, fontWeight:700 }}>
          Call Log - {lead.projectName}
        </div>
        {promoteurCount > 1 && (
          <div style={{ padding:"8px 16px", background:GOLD+"18", borderBottom:"1px solid "+GOLD+"33", fontSize:12, color:GOLD, display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:15 }}>ℹ</span>
            This call will be logged across all {promoteurCount} {lead.promoteur} projects
          </div>
        )}
        <div style={{ flex:1, overflowY:"auto", padding:16 }}>
          {lead.callLog && lead.callLog.length > 0
            ? lead.callLog.slice().reverse().map(function(e,i){
                return <LogEntryRow key={e.date + "|" + e.note} entry={e} color={GOLD}
                  onEdit={props.onEditEntry} onDelete={function(entry){ props.onEditEntry(entry, null); }}/>;
              })
            : <div style={{ color:MUTED, fontSize:13, textAlign:"center", padding:20 }}>No calls logged yet</div>
          }
        </div>
        <div style={{ padding:16, borderTop:"1px solid "+BORDER }}>
          <textarea value={note} onChange={function(e){ setNote(e.target.value); }}
            placeholder="Add call note..."
            rows={2} style={{ width:"100%", background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"8px 10px", color:CREAM, fontSize:13, resize:"vertical", boxSizing:"border-box" }}/>
          <div style={{ display:"flex", gap:8, marginTop:8, justifyContent:"flex-end" }}>
            <button onClick={props.onClose} style={{ padding:"7px 16px", borderRadius:6, border:"1px solid "+BORDER, background:CARD2, color:CREAM, cursor:"pointer", fontSize:13 }}>Close</button>
            <button onClick={addNote} style={{ padding:"7px 16px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700 }}>Log Call</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MeetingLogModal(props) {
  var lead = props.lead;
  var allLeads = props.allLeads;
  var [note, setNote] = useState("");
  var pKey = lead.promoteurKey;
  var promoteurCount = pKey && pKey.length > 2
    ? allLeads.filter(function(l){ return l.promoteurKey === pKey; }).length
    : 1;
  var ovl = { position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center" };
  var sht = { background:CARD, border:"1px solid "+BORDER, borderRadius:12, width:"90%", maxWidth:480, maxHeight:"80vh", display:"flex", flexDirection:"column" };
  function addNote() {
    if (!note.trim()) return;
    props.onAdd({ date: new Date().toISOString().split("T")[0], note: note.trim() });
    setNote("");
  }
  return (
    <div style={ovl} onClick={function(e){ if(e.target===e.currentTarget) props.onClose(); }}>
      <div style={sht}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid "+BORDER, color:"#3b82f6", fontWeight:700 }}>
          Meeting Log - {lead.projectName}
        </div>
        {promoteurCount > 1 && (
          <div style={{ padding:"8px 16px", background:"#3b82f618", borderBottom:"1px solid #3b82f633", fontSize:12, color:"#3b82f6", display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:15 }}>ℹ</span>
            This meeting will be logged across all {promoteurCount} {lead.promoteur} projects
          </div>
        )}
        <div style={{ flex:1, overflowY:"auto", padding:16 }}>
          {lead.meetingLog && lead.meetingLog.length > 0
            ? lead.meetingLog.slice().reverse().map(function(e,i){
                return <LogEntryRow key={e.date + "|" + e.note} entry={e} color={"#3b82f6"}
                  onEdit={props.onEditEntry} onDelete={function(entry){ props.onEditEntry(entry, null); }}/>;
              })
            : <div style={{ color:MUTED, fontSize:13, textAlign:"center", padding:20 }}>No meetings logged yet</div>
          }
        </div>
        <div style={{ padding:16, borderTop:"1px solid "+BORDER }}>
          <textarea value={note} onChange={function(e){ setNote(e.target.value); }}
            placeholder="Add meeting note..."
            rows={2} style={{ width:"100%", background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"8px 10px", color:CREAM, fontSize:13, resize:"vertical", boxSizing:"border-box" }}/>
          <div style={{ display:"flex", gap:8, marginTop:8, justifyContent:"flex-end" }}>
            <button onClick={props.onClose} style={{ padding:"7px 16px", borderRadius:6, border:"1px solid "+BORDER, background:CARD2, color:CREAM, cursor:"pointer", fontSize:13 }}>Close</button>
            <button onClick={addNote} style={{ padding:"7px 16px", borderRadius:6, border:"none", background:"#3b82f6", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>Log Meeting</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneMatchInfo(props) {
  var matches = findPhoneMatches(props.phone, props.leadId, props.allLeads);
  if (!matches.length) return null;
  return (
    <div style={{ marginTop:4, marginBottom:6 }}>
      {matches.map(function(m, i) {
        var isExact = m.type === "exact";
        var src = m.type === "notes" ? "notes" : m.type === "calllog" ? "call log" : "meeting log";
        var color = isExact ? "#ef4444" : "#f59e0b";
        var label = isExact
          ? "\u26a0 Same phone as " + m.lead.projectName + " (" + m.lead.promoteur + ")"
          : "~ Possible match in " + src + " of " + m.lead.projectName;
        return (
          <div key={i} style={{ fontSize:11, color:color, background:color+"22", borderRadius:4,
            padding:"3px 7px", marginBottom:3, border:"1px solid "+color+"44" }}>
            {label}
          </div>
        );
      })}
    </div>
  );
}

function DetailPanel(props) {
  var lead = props.lead;
  var allLeads = props.allLeads;
  var [deleteStep, setDeleteStep] = useState(0);
  if (!lead) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:MUTED, fontSize:14 }}>
      Select a project to view details
    </div>
  );
  var related = allLeads.filter(function(l){
    return l.id !== lead.id && l.promoteurKey && l.promoteurKey === lead.promoteurKey && lead.promoteurKey.length > 2;
  });
  var sec = { marginBottom:18 };
  var lbl = { fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600, marginBottom:4 };
  var val = { fontSize:13, color:CREAM };
  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 20px 40px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:CREAM, marginBottom:6 }}>{lead.projectName}</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <Badge label={lead.pipelineStage} bg={PC[lead.pipelineStage]||MUTED}/>
            <Badge label={lead.priority} bg={PRC[lead.priority]||MUTED}/>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button onClick={function(){ props.onCallLog(lead); }}
            style={{ padding:"6px 12px", borderRadius:6, border:"1px solid "+GOLD+"66", background:"transparent", color:GOLD, cursor:"pointer", fontSize:12 }}>
            + Call Log
          </button>
          <button onClick={function(){ props.onMeetingLog(lead); }}
            style={{ padding:"6px 12px", borderRadius:6, border:"1px solid #3b82f666", background:"transparent", color:"#3b82f6", cursor:"pointer", fontSize:12 }}>
            + Meeting Log
          </button>
          <button onClick={function(){ props.onEdit(lead); }}
            style={{ padding:"6px 14px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:12, fontWeight:700 }}>
            Edit
          </button>
          {deleteStep === 0 && (
            <button onClick={function(){ setDeleteStep(1); }}
              style={{ padding:"6px 12px", borderRadius:6, border:"1px solid #ef444466", background:"transparent", color:"#ef4444", cursor:"pointer", fontSize:12 }}>
              Delete
            </button>
          )}
          {deleteStep === 1 && (
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <span style={{ fontSize:11, color:"#ef4444" }}>Sure?</span>
              <button onClick={function(){ props.onDelete(lead.id); }}
                style={{ padding:"6px 12px", borderRadius:6, border:"none", background:"#ef4444", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700 }}>
                Yes, Delete
              </button>
              <button onClick={function(){ setDeleteStep(0); }}
                style={{ padding:"6px 10px", borderRadius:6, border:"1px solid "+BORDER, background:"transparent", color:MUTED, cursor:"pointer", fontSize:12 }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px" }}>
        <div style={sec}><div style={lbl}>Location</div><div style={val}>{lead.location||"-"}</div></div>
        <div style={sec}><div style={lbl}>Promoteur</div><div style={val}>{lead.promoteur||"-"}</div></div>
        <div style={sec}><div style={lbl}>Contact</div><div style={val}>{lead.contactName||"-"}</div></div>
        <div style={sec}><div style={lbl}>Phone</div><div style={val}>{lead.phone||"-"}</div>
          <PhoneMatchInfo phone={lead.phone} leadId={lead.id} allLeads={allLeads||[]}/>
        </div>
        <div style={sec}><div style={lbl}>Total Units</div><div style={val}>{lead.units||"-"}</div></div>
        <div style={sec}><div style={lbl}>Project Stage</div><div style={val}>{lead.projectStage||"-"}</div></div>
        {lead.region && <div style={sec}><div style={lbl}>Region</div><div style={val}>{lead.region}</div></div>}
        {lead.gpsCoords && (
          <div style={sec}>
            <div style={lbl}>GPS</div>
            <a href={"https://maps.google.com/?q="+encodeURIComponent(lead.gpsCoords)}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize:13, color:GOLD, textDecoration:"none" }}>
              {lead.gpsCoords}
            </a>
          </div>
        )}
        {lead.nextFollowUp && (<div style={sec}><div style={lbl}>Next Follow-Up</div><div style={val}>{lead.nextFollowUp}</div></div>)}
        {(function(){
          var last = lastActivityDate(lead);
          var d = daysSince(last);
          var stale = staleDays(lead);
          return (
            <div style={sec}>
              <div style={lbl}>Last Activity</div>
              <div style={{ ...val, color: stale !== null ? "#f59e0b" : CREAM }}>
                {last ? last + " (" + (d === 0 ? "today" : d + "d ago") + ")" : "-"}
                {stale !== null ? " — going quiet" : ""}
              </div>
            </div>
          );
        })()}
      </div>

      {lead.unitDetails && (
        <div style={sec}>
          <div style={lbl}>Unit Details</div>
          <div style={{ ...val, background:CARD2, borderRadius:6, padding:"10px 12px", border:"1px solid "+BORDER, whiteSpace:"pre-wrap", lineHeight:1.6 }}>{lead.unitDetails}</div>
        </div>
      )}
      {lead.amenities && (
        <div style={sec}>
          <div style={lbl}>Amenities</div>
          <div style={{ ...val, background:CARD2, borderRadius:6, padding:"10px 12px", border:"1px solid "+BORDER, whiteSpace:"pre-wrap", lineHeight:1.6 }}>{lead.amenities}</div>
        </div>
      )}
      {lead.notes && (
        <div style={sec}>
          <div style={lbl}>Notes</div>
          <div style={{ ...val, background:CARD2, borderRadius:6, padding:"10px 12px", border:"1px solid "+BORDER, whiteSpace:"pre-wrap", lineHeight:1.6 }}>{lead.notes}</div>
        </div>
      )}

      {lead.callLog && lead.callLog.length > 0 && (
        <div style={sec}>
          <div style={lbl}>Recent Calls ({lead.callLog.length}) — tap an entry to view / edit all</div>
          {lead.callLog.slice(-3).reverse().map(function(e,i){
            return (
              <div key={i} onClick={function(){ props.onCallLog(lead); }}
                style={{ padding:"7px 10px", background:CARD2, borderRadius:5, borderLeft:"3px solid "+GOLD, marginBottom:6, cursor:"pointer" }}>
                <span style={{ fontSize:11, color:MUTED }}>{e.date} </span>
                <span style={{ fontSize:12, color:CREAM }}>{e.note}</span>
              </div>
            );
          })}
        </div>
      )}

      {lead.meetingLog && lead.meetingLog.length > 0 && (
        <div style={sec}>
          <div style={lbl}>Recent Meetings ({lead.meetingLog.length}) — tap an entry to view / edit all</div>
          {lead.meetingLog.slice(-3).reverse().map(function(e,i){
            return (
              <div key={i} onClick={function(){ props.onMeetingLog(lead); }}
                style={{ padding:"7px 10px", background:CARD2, borderRadius:5, borderLeft:"3px solid #3b82f6", marginBottom:6, cursor:"pointer" }}>
                <span style={{ fontSize:11, color:MUTED }}>{e.date} </span>
                <span style={{ fontSize:12, color:CREAM }}>{e.note}</span>
              </div>
            );
          })}
        </div>
      )}

      {related.length > 0 && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600, borderTop:"1px solid "+BORDER, paddingTop:14, marginBottom:10 }}>
            Other Projects by {lead.promoteur} ({related.length})
          </div>
          {related.map(function(r){
            return (
              <div key={r.id} onClick={function(){ props.onSelect(r); }}
                style={{ padding:"10px 12px", background:CARD2, borderRadius:7, border:"1px solid "+BORDER, marginBottom:7, cursor:"pointer" }}
                onMouseEnter={function(e){ e.currentTarget.style.borderColor=GOLD+"66"; }}
                onMouseLeave={function(e){ e.currentTarget.style.borderColor=BORDER; }}>
                <div style={{ fontSize:13, fontWeight:600, color:CREAM, marginBottom:4 }}>{r.projectName}</div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  <Badge label={r.pipelineStage} bg={PC[r.pipelineStage]||MUTED}/>
                  <Badge label={r.priority} bg={PRC[r.priority]||MUTED}/>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Match extracted fields to an existing lead: AI's pick first, then exact name, then phone.
function findExistingMatch(fields, leads) {
  if (!fields || !leads) return null;
  if (fields.existingId) {
    var byId = leads.find(function(l){ return String(l.id) === String(fields.existingId).trim(); });
    if (byId) return byId;
  }
  var name = (fields.projectName || "").trim().toLowerCase();
  if (name) {
    var byName = leads.find(function(l){ return (l.projectName || "").trim().toLowerCase() === name; });
    if (byName) return byName;
  }
  var phs = phonesIn(fields.phone || "");
  if (phs.length) {
    var byPhone = leads.find(function(l){
      return phonesIn(l.phone).some(function(t){ return phs.indexOf(t) !== -1; });
    });
    if (byPhone) return byPhone;
  }
  return null;
}

var FILTER_PRIORITIES = PRIORITIES;
var MISSING_FIELDS = [
  { key: "promoteur",    label: "No promoteur" },
  { key: "contactName",  label: "No contact name" },
  { key: "phone",        label: "No phone" },
  { key: "region",       label: "No region" },
  { key: "nextFollowUp", label: "No follow-up date" },
  { key: "units",        label: "No units info" },
  { key: "gpsCoords",    label: "No GPS" },
];

function FilterMenu(props) {
  // Hierarchical dropdown: categories → submenu with options.
  var [view, setView] = useState("root");
  useEffect(function(){ if (props.open) setView("root"); }, [props.open]);
  if (!props.open) return null;

  var v = props.values;
  var cats = [
    { id:"priority", label:"Priority",           current: v.priority, options: FILTER_PRIORITIES },
    { id:"stage",    label:"Construction Stage", current: v.stage,    options: PROJECT_STAGES },
    { id:"region",   label:"Region",             current: v.region,   options: props.regions },
    { id:"missing",  label:"Missing info",       current: v.missing === "All" ? "All" : (MISSING_FIELDS.find(function(m){ return m.key === v.missing; }) || {}).label,
      options: MISSING_FIELDS.map(function(m){ return m.label; }) },
  ];
  function optionValue(catId, label) {
    if (catId !== "missing") return label;
    var m = MISSING_FIELDS.find(function(x){ return x.label === label; });
    return m ? m.key : "All";
  }
  function countFor(catId, label) {
    var value = optionValue(catId, label);
    return props.leads.filter(function(l){
      if (l.pipelineStage === "Lost" || l.pipelineStage === "Unwanted") return false;
      if (catId === "priority") return l.priority === value;
      if (catId === "stage")    return l.projectStage === value;
      if (catId === "region")   return l.region === value;
      return !String(l[value] || "").trim();
    }).length;
  }

  var panel = { position:"absolute", top:"100%", left:0, marginTop:4, width:262, maxHeight:330, overflowY:"auto",
    background:CARD2, border:"1px solid "+BORDER, borderRadius:8, zIndex:950, boxShadow:"0 8px 30px rgba(0,0,0,0.5)" };
  var row = { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 14px",
    cursor:"pointer", borderBottom:"1px solid "+BORDER+"66", fontSize:13, color:CREAM };
  var cat = cats.find(function(c){ return c.id === view; });

  return (
    <>
      <div onClick={props.onClose} style={{ position:"fixed", inset:0, zIndex:940 }}/>
      <div style={panel}>
        {view === "root" ? (
          <>
            {cats.map(function(c){
              var active = c.current && c.current !== "All";
              return (
                <div key={c.id} style={row} onClick={function(){ setView(c.id); }}>
                  <span>{c.label}</span>
                  <span style={{ color: active ? GOLD : MUTED, fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {active ? c.current : "All"}
                    </span>
                    ›
                  </span>
                </div>
              );
            })}
            <div style={{ ...row, borderBottom:"none", color:MUTED, fontSize:12, justifyContent:"center" }}
              onClick={function(){ props.onChange("clearAll"); props.onClose(); }}>
              Clear all filters
            </div>
          </>
        ) : (
          <>
            <div style={{ ...row, color:GOLD, fontWeight:700 }} onClick={function(){ setView("root"); }}>
              <span>‹ {cat.label}</span>
            </div>
            <div style={{ ...row, fontWeight: (cat.current === "All" || !cat.current) ? 700 : 400 }}
              onClick={function(){ props.onChange(view, "All"); props.onClose(); }}>
              <span>All</span>
              {(cat.current === "All" || !cat.current) && <span style={{ color:GOLD }}>✓</span>}
            </div>
            {cat.options.map(function(opt){
              var value = optionValue(view, opt);
              var selected = view === "missing" ? v.missing === value : cat.current === opt;
              return (
                <div key={opt} style={{ ...row, fontWeight: selected ? 700 : 400 }}
                  onClick={function(){ props.onChange(view, value); props.onClose(); }}>
                  <span>{opt} <span style={{ color:MUTED, fontSize:11 }}>({countFor(view, opt)})</span></span>
                  {selected && <span style={{ color:GOLD }}>✓</span>}
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

function PasteLeadModal(props) {
  var [text, setText] = useState(props.initialText || "");
  var [img, setImg] = useState(props.initialImage || null); // {mimeType, data, preview}
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [pending, setPending] = useState(null); // {fields, lead} when an existing project matched
  var [batch, setBatch] = useState(null);     // [{fields, match, include}] when several projects found
  var fileRef = useRef(null);
  var jsonRef = useRef(null);
  var hasKey = !!(props.geminiKey && props.geminiKey.trim());
  var canAnalyse = (text.trim() || img) && hasKey && !busy;

  function loadImageFile(file) {
    if (!file || file.type.indexOf("image/") !== 0) return;
    var reader = new FileReader();
    reader.onload = function() {
      var url = reader.result;
      var comma = url.indexOf(",");
      setImg({ mimeType: file.type, data: url.slice(comma + 1), preview: url });
    };
    reader.readAsDataURL(file);
  }
  function handlePaste(e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image/") === 0) {
        loadImageFile(items[i].getAsFile());
        e.preventDefault();
        return;
      }
    }
  }
  function hasContent(p){
    return p && ((p.projectName || "").trim() || (p.promoteur || "").trim() || (p.location || "").trim() || (p.phone || "").trim());
  }
  // Route a parsed list of project entries into the same review flow, whether they
  // came from the AI (text/image) or straight from a JSON file.
  function handleProjects(projects, rawText) {
    if (projects.length === 1) {
      var match = findExistingMatch(projects[0], props.allLeads);
      if (match) {
        setPending({ fields: projects[0], lead: match });
        setBusy(false);
      } else {
        props.onExtracted(projects[0], rawText || "");
      }
    } else {
      setBatch(projects.map(function(p){
        return { fields: p, match: findExistingMatch(p, props.allLeads), include: true };
      }));
      setBusy(false);
    }
  }
  async function analyse() {
    if (!canAnalyse) return;
    setError(""); setBusy(true);
    try {
      var projects = await extractLeadWithAI(text, img, props.geminiKey.trim(), props.regions || DEFAULT_REGIONS, props.allLeads);
      projects = (projects || []).filter(hasContent);
      if (!projects.length) throw new Error("No project found in the text/image.");
      handleProjects(projects, text);
    } catch(e) {
      setError(e && e.message ? e.message : String(e));
      setBusy(false);
    }
  }
  // JSON files are already structured — parse and allocate directly, no AI needed.
  async function loadJsonFile(file) {
    if (!file) return;
    setError(""); setBusy(true);
    try {
      var raw = await file.text();
      var projects;
      if (hasKey) {
        // Let the AI read the JSON and place each value into the right CRM field
        // (and match existing pipeline projects), exactly like text/screenshot import.
        projects = (await extractLeadWithAI(raw, null, props.geminiKey.trim(), props.regions || DEFAULT_REGIONS, props.allLeads) || []).filter(hasContent);
      } else {
        // No AI key: fall back to direct field-alias mapping of structured JSON.
        var data = JSON.parse(raw);
        var arr = Array.isArray(data) ? data
          : (data && Array.isArray(data.projects)) ? data.projects
          : (data && Array.isArray(data.leads)) ? data.leads
          : [data];
        projects = arr.map(normalizeJsonEntry).filter(hasContent);
      }
      if (!projects.length) throw new Error("No usable project entries found in this JSON file.");
      handleProjects(projects, "");
    } catch(e) {
      setError(e && e.message ? ("Couldn't read JSON — " + e.message) : String(e));
      setBusy(false);
    }
  }
  async function applyBatch() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await props.onBatchApply(batch.filter(function(b){ return b.include; }));
    } catch(e) {
      setError(e && e.message ? e.message : String(e));
      setBusy(false);
    }
  }
  var ovl = { position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center", padding:16 };
  var sht = { background:CARD, border:"1px solid "+BORDER, borderRadius:12, width:"100%", maxWidth:520, display:"flex", flexDirection:"column", maxHeight:"92vh", overflowY:"auto" };
  return (
    <div style={ovl} onClick={function(e){ if(e.target===e.currentTarget && !busy) props.onClose(); }} onPaste={handlePaste}>
      <div style={sht}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid "+BORDER, color:GOLD, fontWeight:700 }}>
          ✨ New Lead from Text, Screenshot or JSON
        </div>
        {batch ? (
          <div style={{ padding:16 }}>
            <div style={{ fontSize:13, color:CREAM, lineHeight:1.6, marginBottom:10 }}>
              Found <b style={{ color:GOLD }}>{batch.length} projects</b> — review and apply:
            </div>
            <div style={{ maxHeight:280, overflowY:"auto", marginBottom:12 }}>
              {batch.map(function(item, i){
                var name = (item.fields.projectName || "").trim() ||
                  [(item.fields.promoteur || "").trim(), (item.fields.location || "").trim()].filter(Boolean).join(" – ") || "Unnamed";
                return (
                  <div key={i} onClick={function(){
                      setBatch(batch.map(function(b, j){ return j === i ? { ...b, include: !b.include } : b; }));
                    }}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 10px", marginBottom:6,
                      background:CARD2, borderRadius:7, border:"1px solid "+(item.include ? BORDER : BORDER+"55"),
                      cursor:"pointer", opacity:item.include ? 1 : 0.45 }}>
                    <input type="checkbox" checked={item.include} readOnly style={{ accentColor:GOLD, flexShrink:0 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:CREAM, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
                      {(item.fields.location || item.fields.promoteur) && (
                        <div style={{ fontSize:11, color:MUTED, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {[item.fields.promoteur, item.fields.location].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    {item.match ? (
                      <span style={{ flexShrink:0, fontSize:10, fontWeight:700, color:"#3b82f6", background:"#3b82f622", border:"1px solid #3b82f655", borderRadius:4, padding:"2px 6px" }}>
                        UPDATES {item.match.projectName.length > 14 ? item.match.projectName.slice(0,14).toUpperCase() + "…" : item.match.projectName.toUpperCase()}
                      </span>
                    ) : (
                      <span style={{ flexShrink:0, fontSize:10, fontWeight:700, color:"#10b981", background:"#10b98122", border:"1px solid #10b98155", borderRadius:4, padding:"2px 6px" }}>
                        NEW
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize:11, color:MUTED, lineHeight:1.5, marginBottom:12 }}>
              Updates fill empty fields only — existing data is kept, new details are added to each project's notes.
            </div>
            {error && <div style={{ fontSize:12, color:"#ef4444", marginBottom:10 }}>{error}</div>}
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={function(){ setBatch(null); }} disabled={busy}
                style={{ padding:"8px 14px", borderRadius:6, border:"1px solid "+BORDER, background:"transparent", color:MUTED, cursor:"pointer", fontSize:13, opacity:busy?0.5:1 }}>
                ‹ Back
              </button>
              <button onClick={applyBatch} disabled={busy || !batch.some(function(b){ return b.include; })}
                style={{ padding:"8px 16px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700,
                  opacity:(busy || !batch.some(function(b){ return b.include; }))?0.5:1 }}>
                {busy ? "Applying…" : "Apply " + batch.filter(function(b){ return b.include; }).length + " project(s)"}
              </button>
            </div>
          </div>
        ) : pending ? (
          <div style={{ padding:16 }}>
            <div style={{ fontSize:13, color:CREAM, lineHeight:1.6, marginBottom:6 }}>
              This looks like a project already in your pipeline:
            </div>
            <div style={{ padding:"10px 12px", background:CARD2, borderRadius:8, border:"1px solid "+GOLD+"55", marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:700, color:CREAM }}>{pending.lead.projectName}</div>
              <div style={{ fontSize:12, color:MUTED, marginTop:3 }}>
                {(pending.lead.promoteur || "—")}{pending.lead.location ? " · " + pending.lead.location : ""}
              </div>
            </div>
            <div style={{ fontSize:12, color:MUTED, lineHeight:1.5, marginBottom:14 }}>
              <b style={{ color:GOLD }}>Update</b> fills the empty fields with the new info and adds everything
              else to the notes (your existing data is never overwritten) — you review before saving.
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
              <button onClick={function(){ setPending(null); }}
                style={{ padding:"8px 14px", borderRadius:6, border:"1px solid "+BORDER, background:"transparent", color:MUTED, cursor:"pointer", fontSize:13 }}>
                ‹ Back
              </button>
              <button onClick={function(){ props.onExtracted(pending.fields, text); }}
                style={{ padding:"8px 14px", borderRadius:6, border:"1px solid "+GOLD+"66", background:"transparent", color:GOLD, cursor:"pointer", fontSize:13 }}>
                Create new lead
              </button>
              <button onClick={function(){ props.onUpdateExisting(pending.lead, pending.fields, text); }}
                style={{ padding:"8px 16px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700 }}>
                Update "{pending.lead.projectName.length > 22 ? pending.lead.projectName.slice(0,22) + "…" : pending.lead.projectName}"
              </button>
            </div>
          </div>
        ) : (
        <>
        <div style={{ padding:16 }}>
          <div style={{ fontSize:12, color:MUTED, marginBottom:10, lineHeight:1.5 }}>
            Paste ad text and/or a screenshot — AI fills the lead form for you to review.
            Or import a <b style={{ color:GOLD }}>JSON file</b> below to allocate many projects at once.
          </div>
          <textarea value={text} onChange={function(e){ setText(e.target.value); }}
            placeholder="Paste the announcement text here (Ctrl+V also works for screenshots)..."
            rows={7} autoFocus
            style={{ width:"100%", background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"10px 12px", color:CREAM, fontSize:13, resize:"vertical", boxSizing:"border-box" }}/>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
            onChange={function(e){ loadImageFile(e.target.files && e.target.files[0]); e.target.value=""; }}/>
          {img ? (
            <div style={{ marginTop:8, position:"relative", display:"inline-block" }}>
              <img src={img.preview} alt="screenshot"
                style={{ maxHeight:130, maxWidth:"100%", borderRadius:6, border:"1px solid "+BORDER, display:"block" }}/>
              <button onClick={function(){ setImg(null); }}
                style={{ position:"absolute", top:-8, right:-8, width:22, height:22, borderRadius:11, border:"none",
                  background:"#ef4444", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, lineHeight:1 }}>✕</button>
            </div>
          ) : (
            <button onClick={function(){ fileRef.current && fileRef.current.click(); }}
              style={{ marginTop:8, padding:"7px 14px", borderRadius:6, border:"1px dashed "+GOLD+"66", background:"transparent",
                color:GOLD, cursor:"pointer", fontSize:12 }}>
              📷 Add screenshot
            </button>
          )}
          <input ref={jsonRef} type="file" accept=".json,application/json" style={{ display:"none" }}
            onChange={function(e){ loadJsonFile(e.target.files && e.target.files[0]); e.target.value=""; }}/>
          <div style={{ marginTop:8 }}>
            <button onClick={function(){ jsonRef.current && jsonRef.current.click(); }} disabled={busy}
              style={{ padding:"7px 14px", borderRadius:6, border:"1px dashed "+GOLD+"66", background:"transparent",
                color:GOLD, cursor:busy?"default":"pointer", fontSize:12, opacity:busy?0.5:1 }}>
              📄 Import JSON file
            </button>
          </div>
          {!hasKey && (
            <div style={{ marginTop:8, fontSize:12, color:"#f59e0b", background:"#f59e0b18", border:"1px solid #f59e0b55", borderRadius:6, padding:"8px 10px", lineHeight:1.5 }}>
              No AI key configured. Add your free Gemini API key in Settings → AI Extraction first.
            </div>
          )}
          {error && <div style={{ marginTop:8, fontSize:12, color:"#ef4444", lineHeight:1.4 }}>{error}</div>}
        </div>
        <div style={{ padding:"0 16px 16px", display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={props.onClose} disabled={busy}
            style={{ padding:"8px 16px", borderRadius:6, border:"1px solid "+BORDER, background:CARD2, color:CREAM, cursor:"pointer", fontSize:13, opacity:busy?0.5:1 }}>Cancel</button>
          <button onClick={analyse} disabled={!canAnalyse}
            style={{ padding:"8px 18px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700,
              opacity:canAnalyse?1:0.5 }}>
            {busy ? "Analysing…" : "Analyse with AI"}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

function ToggleRow(props) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid #1c355044" }}>
      <div style={{ flex:1, paddingRight:16 }}>
        <div style={{ fontSize:13, color:CREAM, fontWeight:500 }}>{props.label}</div>
        <div style={{ fontSize:11, color:MUTED, marginTop:2 }}>{props.sub}</div>
      </div>
      <div onClick={props.onChange}
        style={{ width:44, height:24, borderRadius:12, background: props.checked ? GOLD : BORDER,
          cursor:"pointer", position:"relative", flexShrink:0, transition:"background 0.2s" }}>
        <div style={{ position:"absolute", top:3, left: props.checked ? 23 : 3,
          width:18, height:18, borderRadius:9, background:"#fff", transition:"left 0.2s" }}/>
      </div>
    </div>
  );
}

function SettingsModal(props) {
  var s = props.settings;
  var inAppSettings = typeof navigator !== "undefined" && /SynRegisApp/.test(navigator.userAgent);
  var [keyDraft, setKeyDraft] = useState(props.geminiKey || "");
  var [keySaved, setKeySaved] = useState(false);
  var [pwDraft, setPwDraft] = useState("");
  var [pwMsg, setPwMsg] = useState(null); // {ok, text}
  var [backups, setBackups] = useState(null);   // null = not loaded yet, [] = none
  var [backupsErr, setBackupsErr] = useState("");
  var [confirmRestore, setConfirmRestore] = useState(null); // a backup pending confirmation
  var [restoreMsg, setRestoreMsg] = useState(null);         // {ok, text}
  var [restoring, setRestoring] = useState(false);
  useEffect(function() {
    if (!props.onLoadBackups) return;
    var alive = true;
    props.onLoadBackups()
      .then(function(list){ if (alive) setBackups(list || []); })
      .catch(function(e){ if (alive) setBackupsErr((e && e.message) || "Could not load backups."); });
    return function(){ alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function doRestore(b) {
    setRestoring(true); setRestoreMsg(null);
    try {
      await props.onRestore(b);
      setRestoreMsg({ ok:true, text:"Restored " + (b.count||"the") + " projects from " + (b.date||"backup") + ". They'll appear in the list now." });
      setConfirmRestore(null);
    } catch(e) {
      setRestoreMsg({ ok:false, text:"Restore failed — " + ((e && e.message) || String(e)) });
    }
    setRestoring(false);
  }
  function set(key, val) { props.onChange(Object.assign({}, s, { [key]: val })); }
  function toggle(key) { set(key, !s[key]); }
  var [keyError, setKeyError] = useState("");
  async function saveKey() {
    setKeyError("");
    try {
      await props.onSaveGeminiKey(keyDraft.trim());
      setKeySaved(true);
      setTimeout(function(){ setKeySaved(false); }, 2000);
    } catch(e) {
      setKeyError("Could not save — " + ((e && e.code) === "permission-denied"
        ? "the database refused the write (check Firestore rules)."
        : ((e && e.message) || String(e))));
    }
  }
  async function saveAppPassword() {
    setPwMsg(null);
    var pw = pwDraft;
    if (pw.length < 6) { setPwMsg({ ok:false, text:"Password must be at least 6 characters." }); return; }
    var user = auth.currentUser;
    if (!user || !user.email) { setPwMsg({ ok:false, text:"Not signed in." }); return; }
    try {
      await linkWithCredential(user, EmailAuthProvider.credential(user.email, pw));
      setPwMsg({ ok:true, text:"App password set. You can now sign in with email + password in the app." });
      setPwDraft("");
    } catch(e) {
      if (e && e.code === "auth/provider-already-linked") {
        try {
          await updatePassword(user, pw);
          setPwMsg({ ok:true, text:"App password updated." });
          setPwDraft("");
        } catch(e2) {
          setPwMsg({ ok:false, text: e2 && e2.code === "auth/requires-recent-login"
            ? "For security, sign out and sign in again, then retry."
            : (e2 && e2.message) || String(e2) });
        }
      } else if (e && e.code === "auth/requires-recent-login") {
        setPwMsg({ ok:false, text:"For security, sign out and sign in again, then retry." });
      } else if (e && e.code === "auth/operation-not-allowed") {
        setPwMsg({ ok:false, text:"Email/password sign-in is not enabled in Firebase yet (Console → Authentication → Sign-in method)." });
      } else {
        setPwMsg({ ok:false, text:(e && e.message) || String(e) });
      }
    }
  }
  var ovl = { position:"fixed", inset:0, background:"#000000aa", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" };
  var box = { background:CARD, border:"1px solid "+BORDER, borderRadius:12, padding:28, width:360, maxWidth:"92vw", maxHeight:"90vh", overflowY:"auto" };
  function requestAndToggle(key) {
    if (s[key]) { toggle(key); return; }
    if (!("Notification" in window)) { alert("Notifications are not supported in this browser."); return; }
    Notification.requestPermission().then(function(p) {
      if (p === "granted") { toggle(key); }
      else { alert("Please allow notifications in your browser settings first."); }
    });
  }
  return (
    <div style={ovl} onClick={function(e){ if(e.target===e.currentTarget) props.onClose(); }}>
      <div style={box}>
        <div style={{ fontSize:16, fontWeight:700, color:GOLD, marginBottom:20 }}>Settings</div>
        <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>
          Follow-Up Alerts
        </div>
        <ToggleRow label="Badge on lead rows" sub="Red/orange tag on leads with overdue or due-today follow-ups"
          checked={s.badge} onChange={function(){ toggle("badge"); }}/>
        <ToggleRow label="Due Today banner" sub="Summary strip at top of the leads list"
          checked={s.banner} onChange={function(){ toggle("banner"); }}/>
        <ToggleRow label="Stale lead alerts" sub={"Amber tag on active leads with no call or meeting logged for " + STALE_DAYS + "+ days"}
          checked={s.stale} onChange={function(){ toggle("stale"); }}/>

        <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginTop:16, marginBottom:4, borderTop:"1px solid "+BORDER, paddingTop:14 }}>
          {inAppSettings ? "Phone Notifications" : "Notifications"}
        </div>
        {inAppSettings ? (
          <>
            <ToggleRow label="Daily follow-up reminder" sub="Notification at the set time, even with the app closed"
              checked={s.appNotif} onChange={function(){
                if (!s.appNotif && window.SynRegisNative && window.SynRegisNative.requestNotificationPermission) {
                  try { window.SynRegisNative.requestNotificationPermission(); } catch(e) {}
                }
                toggle("appNotif");
              }}/>
            {s.appNotif && (
              <>
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:"1px solid #1c355044" }}>
                  <span style={{ fontSize:13, color:CREAM, flex:1 }}>Remind at</span>
                  <input type="time" value={s.notifTime}
                    onChange={function(e){ set("notifTime", e.target.value); }}
                    style={{ background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"6px 10px", color:CREAM, fontSize:13, outline:"none" }}/>
                  <span style={{ fontSize:11, color:MUTED }}>daily</span>
                </div>
                <ToggleRow label="Include quiet leads" sub={"Add the count of leads silent for " + STALE_DAYS + "+ days to the daily reminder"}
                  checked={s.appNotifStale} onChange={function(){ toggle("appNotifStale"); }}/>
              </>
            )}
            <div style={{ fontSize:11, color:MUTED, marginTop:10, lineHeight:1.5 }}>
              No notification is sent on days with nothing due. If reminders don't arrive, allow SynRegis in the phone's battery settings (Huawei limits background apps).
            </div>
          </>
        ) : (
          <>
            <ToggleRow label="Browser notifications" sub="Desktop popup when you open the CRM (if follow-ups are due)"
              checked={s.browserNotif} onChange={function(){ requestAndToggle("browserNotif"); }}/>
            {s.browserNotif && (
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0" }}>
                <span style={{ fontSize:13, color:CREAM, flex:1 }}>Notify after</span>
                <input type="time" value={s.notifTime}
                  onChange={function(e){ set("notifTime", e.target.value); }}
                  style={{ background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"6px 10px", color:CREAM, fontSize:13, outline:"none" }}/>
                <span style={{ fontSize:11, color:MUTED }}>daily</span>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop:16, borderTop:"1px solid "+BORDER, paddingTop:14 }}>
          <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginBottom:8 }}>
            AI Extraction
          </div>
          <div style={{ fontSize:11, color:MUTED, marginBottom:8, lineHeight:1.5 }}>
            Free Gemini API key for the "New Lead from Text" feature — create one at aistudio.google.com (Get API key).
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <input type="password" value={keyDraft} placeholder="Gemini API key (AIza...)"
              onChange={function(e){ setKeyDraft(e.target.value); }}
              style={{ flex:1, minWidth:0, background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"8px 10px", color:CREAM, fontSize:12, outline:"none" }}/>
            <button onClick={saveKey}
              style={{ padding:"8px 14px", borderRadius:6, border:"none", background:keySaved?"#10b981":GOLD, color:keySaved?"#fff":NAVY, cursor:"pointer", fontSize:12, fontWeight:700, flexShrink:0 }}>
              {keySaved ? "Saved ✓" : "Save"}
            </button>
          </div>
          {keyError && <div style={{ marginTop:8, fontSize:11, color:"#ef4444", lineHeight:1.4 }}>{keyError}</div>}
        </div>

        <div style={{ marginTop:16, borderTop:"1px solid "+BORDER, paddingTop:14 }}>
          <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginBottom:8 }}>
            Backups &amp; Restore
          </div>
          <div style={{ fontSize:11, color:MUTED, marginBottom:10, lineHeight:1.5 }}>
            A full snapshot of all {props.leadCount != null ? props.leadCount + " " : ""}projects is saved automatically every day and each time you close the app. Restoring re-adds and reverts projects to a snapshot — it never deletes anything you've added since.
          </div>
          {backupsErr && <div style={{ fontSize:11, color:"#ef4444", lineHeight:1.4, marginBottom:8 }}>{backupsErr}</div>}
          {restoreMsg && <div style={{ fontSize:11, lineHeight:1.4, marginBottom:8, color: restoreMsg.ok ? "#10b981" : "#ef4444" }}>{restoreMsg.text}</div>}
          {backups === null && !backupsErr && <div style={{ fontSize:12, color:MUTED }}>Loading backups…</div>}
          {backups !== null && backups.length === 0 && (
            <div style={{ fontSize:12, color:MUTED }}>No backups yet — the first one saves automatically today.</div>
          )}
          {backups !== null && backups.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:200, overflowY:"auto" }}>
              {backups.map(function(b){
                var pending = confirmRestore && confirmRestore.date === b.date;
                return (
                  <div key={b.date} style={{ background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"8px 10px" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:12, color:CREAM, fontWeight:600 }}>{b.date}</div>
                        <div style={{ fontSize:10, color:MUTED }}>{(b.count != null ? b.count + " projects" : "")}{b.reason ? " · " + b.reason : ""}</div>
                      </div>
                      {!pending ? (
                        <button onClick={function(){ setConfirmRestore(b); setRestoreMsg(null); }} disabled={restoring}
                          style={{ flexShrink:0, padding:"5px 10px", borderRadius:5, border:"1px solid "+GOLD, background:"transparent", color:GOLD, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                          Restore
                        </button>
                      ) : (
                        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                          <button onClick={function(){ doRestore(b); }} disabled={restoring}
                            style={{ padding:"5px 10px", borderRadius:5, border:"none", background:"#10b981", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:700 }}>
                            {restoring ? "…" : "Confirm"}
                          </button>
                          <button onClick={function(){ setConfirmRestore(null); }} disabled={restoring}
                            style={{ padding:"5px 10px", borderRadius:5, border:"1px solid "+BORDER, background:"transparent", color:MUTED, cursor:"pointer", fontSize:11 }}>
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop:16, borderTop:"1px solid "+BORDER, paddingTop:14 }}>
          <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginBottom:8 }}>
            App Password
          </div>
          <div style={{ fontSize:11, color:MUTED, marginBottom:8, lineHeight:1.5 }}>
            Set a password to sign in inside the SynRegis Android app (Google sign-in doesn't work there). Same account, same data.
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <input type="password" value={pwDraft} placeholder="New app password (min 6 chars)"
              onChange={function(e){ setPwDraft(e.target.value); }}
              style={{ flex:1, minWidth:0, background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"8px 10px", color:CREAM, fontSize:12, outline:"none" }}/>
            <button onClick={saveAppPassword}
              style={{ padding:"8px 14px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:12, fontWeight:700, flexShrink:0 }}>
              Set
            </button>
          </div>
          {pwMsg && <div style={{ marginTop:8, fontSize:11, lineHeight:1.4, color: pwMsg.ok ? "#10b981" : "#ef4444" }}>{pwMsg.text}</div>}
        </div>
        {!(typeof navigator !== "undefined" && /SynRegisApp/.test(navigator.userAgent)) && (
          <div style={{ marginTop:16, borderTop:"1px solid "+BORDER, paddingTop:14 }}>
            <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginBottom:8 }}>
              Install on this PC
            </div>
            {isStandalone() ? (
              <div style={{ fontSize:12, color:"#10b981", fontWeight:600 }}>✓ Installed — you're running the app.</div>
            ) : props.canInstall ? (
              <>
                <button onClick={props.onInstall}
                  style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%", boxSizing:"border-box",
                    padding:"9px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontWeight:700, fontSize:13 }}>
                  ⬇ Install SynRegis as an app
                </button>
                <div style={{ fontSize:11, color:MUTED, marginTop:8, lineHeight:1.5 }}>
                  Adds SynRegis to your desktop / Start menu and opens it in its own window — no browser tabs.
                </div>
              </>
            ) : (
              <div style={{ fontSize:11, color:MUTED, lineHeight:1.5 }}>
                In Chrome or Edge, click the install icon (<span style={{ color:CREAM }}>⊕</span> / monitor icon) at the right of the address bar, or menu → "Install SynRegis CRM". Safari and Firefox can't install web apps — use Chrome or Edge.
              </div>
            )}
          </div>
        )}
        {!(typeof navigator !== "undefined" && /SynRegisApp/.test(navigator.userAgent)) && (
          <div style={{ marginTop:16, borderTop:"1px solid "+BORDER, paddingTop:14 }}>
            <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginBottom:8 }}>
              Android App
            </div>
            <a href="/synregis.apk" download
              style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%", boxSizing:"border-box",
                padding:"9px", borderRadius:6, border:"1px solid "+GOLD, background:"transparent",
                color:GOLD, fontWeight:700, fontSize:13, textDecoration:"none" }}>
              ⬇ Télécharger l'app Android (.apk)
            </a>
            <div style={{ fontSize:11, color:MUTED, marginTop:8, lineHeight:1.5 }}>
              Sur le téléphone : ouvrez ce lien, autorisez l'installation, puis connectez-vous avec email + mot de passe (section App Password ci-dessus).
            </div>
          </div>
        )}
        <button onClick={props.onClose}
          style={{ marginTop:20, width:"100%", padding:"9px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontWeight:700, fontSize:13 }}>
          Done
        </button>
      </div>
    </div>
  );
}

function LeadRow(props) {
  var lead = props.lead;
  var sel = props.selected;
  var today = new Date().toISOString().split("T")[0];
  var fu = lead.nextFollowUp;
  var isOverdue = fu && fu < today;
  var isDueToday = fu && fu === today;
  var showBadge = props.settings && props.settings.badge && (isOverdue || isDueToday);
  var badgeColor = isOverdue ? "#ef4444" : "#f59e0b";
  var badgeLabel = isOverdue ? "Overdue" : "Today";
  var stale = props.settings && props.settings.stale ? staleDays(lead) : null;
  var showStale = !showBadge && stale !== null;
  return (
    <div onClick={function(){ props.onSelect(lead); }}
      style={{
        padding:"12px 14px", cursor:"pointer", borderBottom:"1px solid "+BORDER,
        background: sel ? CARD2 : "transparent",
        borderLeft: sel ? "3px solid "+GOLD : "3px solid "+(showBadge ? badgeColor : showStale ? "#f59e0b88" : "transparent")
      }}
      onMouseEnter={function(e){ if(!sel) e.currentTarget.style.background=CARD2+"88"; }}
      onMouseLeave={function(e){ if(!sel) e.currentTarget.style.background="transparent"; }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div style={{ fontWeight:600, fontSize:13, color:CREAM, marginBottom:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flex:1 }}>
          {lead.projectName}
        </div>
        {showBadge && (
          <span style={{ flexShrink:0, marginLeft:6, fontSize:10, fontWeight:700, color:"#fff", background:badgeColor, borderRadius:4, padding:"1px 5px" }}>
            {badgeLabel}
          </span>
        )}
        {showStale && (
          <span style={{ flexShrink:0, marginLeft:6, fontSize:10, fontWeight:700, color:"#f59e0b", background:"#f59e0b22", border:"1px solid #f59e0b55", borderRadius:4, padding:"0px 5px" }}>
            Quiet {stale}d
          </span>
        )}
      </div>
      <div style={{ fontSize:11, color:MUTED, marginBottom:5, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
        {lead.promoteur} - {lead.location}
      </div>
      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
        <Badge label={lead.pipelineStage} bg={PC[lead.pipelineStage]||MUTED}/>
        <Badge label={lead.priority} bg={PRC[lead.priority]||MUTED}/>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
// ── Splash Screen ─────────────────────────────────────────────────────────────
function SplashScreen({ visible }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: NAVY,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 20,
      opacity: visible ? 1 : 0,
      transition: "opacity 0.7s ease",
      pointerEvents: visible ? "all" : "none",
    }}>
      <img
        src={LOGO_SRC}
        alt="SynRegis"
        loading="eager"
        fetchPriority="high"
        onError={function(e){ if (e.target.src.indexOf("logo512")===-1) e.target.src="/logo512.png"; }}
        style={{
          width: "85vw",
          maxWidth: 400,
          objectFit: "contain",
        }}
      />
    </div>
  );
}

// ── Auth gate ─────────────────────────────────────────────────────────────────
function Gate(props) {
  var [user, setUser]               = useState(undefined);
  var [phase, setPhase]             = useState("checking");
  var [authError, setAuthError]     = useState("");
  var [email, setEmail]             = useState(ALLOWED_EMAILS.length === 1 ? ALLOWED_EMAILS[0] : "");
  var [pw, setPw]                   = useState("");
  var [autoBusy, setAutoBusy]       = useState(false);
  var autoTried = useRef(false);
  // Inside the Android wrapper Google's OAuth popup is blocked — email only.
  var inApp = typeof navigator !== "undefined" && /SynRegisApp/.test(navigator.userAgent);

  // In the app, the fingerprint gate already protects entry — so a stored
  // (hardware-encrypted) credential signs in silently. No typing, ever.
  useEffect(function() {
    if (phase !== "signin" || autoTried.current || !inApp) return;
    if (!window.SynRegisNative || !window.SynRegisNative.getCredentials) return;
    var packed = "";
    try { packed = window.SynRegisNative.getCredentials() || ""; } catch(e) {}
    if (!packed) return;
    autoTried.current = true;
    var sep = packed.indexOf("\n");
    if (sep < 1) return;
    setAutoBusy(true);
    signInWithEmailAndPassword(auth, packed.slice(0, sep), packed.slice(sep + 1))
      .catch(function() {
        // Stored password no longer valid — drop it and show the form once
        try { window.SynRegisNative.clearCredentials(); } catch(e) {}
        setAutoBusy(false);
        setAuthError("Saved sign-in expired — enter your password once to refresh it.");
      });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(function() {
    return onAuthStateChanged(auth, function(u) {
      setUser(u);
      if (!u) { setPhase("signin"); return; }
      if (ALLOWED_EMAILS.indexOf(u.email) === -1) { setPhase("wrongAccount"); return; }
      setPhase("unlocked");
    });
  }, []);

  function doSignIn() {
    setAuthError("");
    signInWithPopup(auth, googleProvider).catch(function(e){
      setAuthError(e && e.message ? e.message : String(e));
    });
  }
  function doForgotPassword() {
    setAuthError("");
    if (!email.trim()) { setAuthError("Enter your email first."); return; }
    sendPasswordResetEmail(auth, email.trim()).then(function(){
      setAuthError("Reset link sent — check your inbox (" + email.trim() + "), set a new password, then sign in here.");
    }).catch(function(e){
      setAuthError(e && e.message ? e.message : String(e));
    });
  }
  function doEmailSignIn() {
    setAuthError("");
    if (!email.trim() || !pw) { setAuthError("Enter email and password."); return; }
    signInWithEmailAndPassword(auth, email.trim(), pw).then(function(){
      // Remember inside the app so future opens are fingerprint-only
      if (inApp && window.SynRegisNative && window.SynRegisNative.storeCredentials) {
        try { window.SynRegisNative.storeCredentials(email.trim(), pw); } catch(e) {}
      }
    }).catch(function(e){
      var code = e && e.code;
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setAuthError("Wrong password — or no app password set yet. Set one on the website: Settings → App Password.");
      } else if (code === "auth/operation-not-allowed") {
        setAuthError("Email sign-in not enabled yet (Firebase Console → Authentication → Sign-in method → Email/Password).");
      } else {
        setAuthError(e && e.message ? e.message : String(e));
      }
    });
  }
  function doSignOut() {
    signOut(auth);
  }

  var wrap = { minHeight: "100vh", background: NAVY, color: CREAM, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "system-ui, -apple-system, sans-serif" };
  var card = { background: CARD, border: "1px solid " + BORDER, borderRadius: 12, padding: 32, maxWidth: 360, width: "100%", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.4)" };
  var h1   = { color: GOLD, fontSize: 22, fontWeight: 700, margin: "0 0 8px", letterSpacing: 1 };
  var sub  = { color: MUTED, fontSize: 13, margin: "0 0 24px", lineHeight: 1.5 };
  var btn  = { width: "100%", padding: "12px 16px", borderRadius: 8, background: GOLD, color: NAVY, border: "none", fontWeight: 700, cursor: "pointer", fontSize: 14, letterSpacing: 0.5 };
  var err  = { color: "#ef4444", fontSize: 12, margin: "8px 0 0", minHeight: 16 };
  var floatBar = { position: "fixed", bottom: 12, right: 12, zIndex: 9999, display: "flex", gap: 6 };
  var floatBtnMuted = { background: CARD, color: MUTED, border: "1px solid " + BORDER, borderRadius: 999, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontWeight: 500, letterSpacing: 0.5 };

  if (phase === "checking") {
    return <div style={wrap}><div style={card}><div style={sub}>Loading…</div></div></div>;
  }
  if (phase === "signin") {
    if (autoBusy) {
      return <div style={wrap}><div style={card}><div style={sub}>Signing in…</div></div></div>;
    }
    var inpSt = { width:"100%", boxSizing:"border-box", background:"#091525", border:"1px solid "+BORDER, borderRadius:8, padding:"11px 12px", color:CREAM, fontSize:14, outline:"none", marginBottom:8 };
    return (
      <div style={wrap}><div style={card}>
        <h1 style={h1}>SYNREGIS CRM</h1>
        <p style={sub}>Sign in to continue.</p>
        {!inApp && (
          <>
            <button style={btn} onClick={doSignIn}>Sign in with Google</button>
            <div style={{ display:"flex", alignItems:"center", gap:10, margin:"16px 0", color:MUTED, fontSize:11 }}>
              <div style={{ flex:1, height:1, background:BORDER }}/>or<div style={{ flex:1, height:1, background:BORDER }}/>
            </div>
          </>
        )}
        <input style={inpSt} type="email" placeholder="Email" value={email} autoComplete="username"
          onChange={function(e){ setEmail(e.target.value); }}/>
        <input style={inpSt} type="password" placeholder="Password" value={pw} autoComplete="current-password"
          onChange={function(e){ setPw(e.target.value); }}
          onKeyDown={function(e){ if (e.key === "Enter") doEmailSignIn(); }}/>
        <button style={Object.assign({}, btn, inApp ? {} : { background:"transparent", color:GOLD, border:"1px solid "+GOLD+"66" })}
          onClick={doEmailSignIn}>
          Sign in with password
        </button>
        <button onClick={doForgotPassword}
          style={{ background:"none", border:"none", color:MUTED, cursor:"pointer", marginTop:12, fontSize:12, textDecoration:"underline" }}>
          Forgot password?
        </button>
        {authError ? <p style={err}>{authError}</p> : null}
      </div></div>
    );
  }
  if (phase === "wrongAccount") {
    return (
      <div style={wrap}><div style={card}>
        <h1 style={h1}>NOT AUTHORISED</h1>
        <p style={sub}>This account ({user && user.email}) is not allowed to access this CRM.</p>
        <button style={btn} onClick={doSignOut}>Sign out</button>
      </div></div>
    );
  }
  return (
    <>
      {props.children}
      {!inApp && (
        <div style={floatBar}>
          <button style={floatBtnMuted} onClick={doSignOut}>SIGN OUT</button>
        </div>
      )}
    </>
  );
}

function AppInner() {
  var [leads, setLeads]               = useState([]);
  var [loading, setLoading]           = useState(true);
  var [synced, setSynced]             = useState(false); // true once the live server snapshot has loaded (not just cache)
  var [dbError, setDbError]           = useState("");    // set when Firestore can't be reached — shown, never silent
  var [selected, setSelected]         = useState(null);
  var [search, setSearch]             = useState("");
  var [filterPipeline, setFilterPipeline] = useState("All");
  var [filterPriority, setFilterPriority] = useState("All");
  var [filterStage, setFilterStage]       = useState("All");
  var [filterMissing, setFilterMissing]   = useState("All");
  var [showFilters, setShowFilters]       = useState(false);
  var [showArchive, setShowArchive] = useState(false);
  var [showAdd, setShowAdd]           = useState(false);
  var [editLead, setEditLead]         = useState(null);
  var [editDraft, setEditDraft]       = useState(null);
  var [syncContact, setSyncContact]   = useState(false);
  var [callLogLead, setCallLogLead]       = useState(null);
  var [meetingLogLead, setMeetingLogLead] = useState(null);
  var [filterRegion, setFilterRegion]     = useState("All");
  var [regions, setRegions]               = useState(DEFAULT_REGIONS);
  var [showEditRegions, setShowEditRegions] = useState(false);
  var [showSettings, setShowSettings]     = useState(false);
  var [showExport, setShowExport]         = useState(null); // JSON string when the export view is open
  var [settings, setSettings]             = useState(loadSettings);
  var [showSplash, setShowSplash]         = useState(true);
  var [groupByProm, setGroupByProm]       = useState(false);
  var [quietExpanded, setQuietExpanded]   = useState(false); // GOING QUIET banner: show all stale leads, not just the first 5
  var [installEvt, setInstallEvt]         = useState(_deferredInstall); // deferred PWA install prompt (desktop)
  var [appUpdate, setAppUpdate]           = useState(null); // {versionName, url} when a newer APK exists
  var [showPaste, setShowPaste]           = useState(null);   // null = closed, string = open with initial text
  var [sharedImg, setSharedImg]           = useState(null);   // image shared from the Android app
  var [addPrefill, setAddPrefill]         = useState(null);
  var [geminiKey, setGeminiKey]           = useState("");
  var isMobile = useIsMobile();
  var backArmed = useRef(false);
  var layersRef = useRef([]);

  // ── Splash: dismiss after 2.5 s ───────────────────────────────────────────
  useEffect(function() {
    var t = setTimeout(function() { setShowSplash(false); }, 2500);
    return function() { clearTimeout(t); };
  }, []);

  // ── App self-update check (Android wrapper only) ──────────────────────────
  useEffect(function() {
    if (!window.SynRegisNative || !window.SynRegisNative.getAppVersion) return;
    var installed = 0;
    try { installed = parseInt(window.SynRegisNative.getAppVersion(), 10) || 0; } catch(e) { return; }
    fetch("/app-version.json?t=" + Date.now(), { cache: "no-store" })
      .then(function(r){ return r.json(); })
      .then(function(v){
        if (v && v.versionCode > installed) {
          setAppUpdate({ versionName: v.versionName || String(v.versionCode), url: v.url });
        }
      })
      .catch(function(){});
  }, []);

  // ── PWA install prompt availability (desktop Chrome/Edge) ─────────────────
  useEffect(function() {
    function onAvail(){ setInstallEvt(_deferredInstall); }
    function onInstalled(){ setInstallEvt(null); }
    window.addEventListener("synregis-installable", onAvail);
    window.addEventListener("synregis-installed", onInstalled);
    return function(){
      window.removeEventListener("synregis-installable", onAvail);
      window.removeEventListener("synregis-installed", onInstalled);
    };
  }, []);

  function installPwa() {
    if (!_deferredInstall) return;
    _deferredInstall.prompt();
    _deferredInstall.userChoice.then(function(){ _deferredInstall = null; setInstallEvt(null); });
  }

  // ── Firestore real-time subscription ──────────────────────────────────────
  useEffect(function() {
    var leadsCol = collection(db, "leads");
    // includeMetadataChanges lets us tell a cached/partial emission (fromCache)
    // apart from a confirmed live one — so we never treat half-loaded data as truth.
    var unsub = onSnapshot(leadsCol, { includeMetadataChanges: true },
      async function(snap) {
        var fromCache = snap.metadata && snap.metadata.fromCache;
        if (snap.empty) {
          // Seed ONLY when the SERVER confirms the collection is empty. Never seed
          // from an empty cache (offline cold start) — that would clobber real data.
          if (fromCache) return;
          var batch = writeBatch(db);
          INITIAL_LEADS.forEach(function(lead) {
            var ref = doc(collection(db, "leads"), String(lead.id));
            batch.set(ref, lead);
          });
          await batch.commit();
          // onSnapshot fires again automatically once seeding completes
          return;
        }
        var data = snap.docs.map(function(d) { return { ...d.data(), id: d.id }; });
        setLeads(data);
        setLoading(false);
        setDbError("");
        setSynced(!fromCache); // true only when this is the live server set
      },
      function(err) {
        // Surface it — never leave the user staring at a silent empty pipeline.
        console.error("Firestore error:", err);
        setLoading(false);
        setSynced(false);
        setDbError(err && err.code === "permission-denied"
          ? "permission-denied"
          : "offline");
      }
    );
    return function() { unsub(); };
  }, []);

  // ── Load/save custom regions + AI key ──────────────────────────────────────
  useEffect(function() {
    async function loadConfig() {
      try {
        var snap = await getDoc(doc(db, "config", "app"));
        if (snap.exists()) {
          if (snap.data().regions) setRegions(snap.data().regions);
          if (snap.data().geminiKey) setGeminiKey(snap.data().geminiKey);
        }
      } catch(e) { /* use defaults */ }
    }
    loadConfig();
  }, []);

  async function saveGeminiKey(key) {
    setGeminiKey(key);
    // Let the failure propagate so Settings can show an honest error
    await setDoc(doc(db, "config", "app"), { geminiKey: key }, { merge: true });
  }

  // ── Shared text/image from the Android app (share → SynRegis) ──────────────
  useEffect(function() {
    try {
      var p = new URLSearchParams(window.location.search);
      var sharedText = p.get("shared");
      if (sharedText) {
        setShowPaste(sharedText);
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
      // Shared image is too large for a URL — the wrapper exposes it via a JS bridge
      if (p.get("sharedimg") === "1" && window.SynRegisNative && window.SynRegisNative.getSharedImage) {
        var packed = window.SynRegisNative.getSharedImage();
        if (packed) {
          var sep = packed.indexOf(";");
          var mime = packed.slice(0, sep);
          var b64 = packed.slice(sep + 1);
          setSharedImg({ mimeType: mime, data: b64, preview: "data:" + mime + ";base64," + b64 });
          setShowPaste("");
        }
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch(e) {}
  }, []);

  function handleExtracted(fields, rawText) {
    var f = fields || {};
    var promoteur = (f.promoteur || "").trim();
    var region = (f.region || "").trim();
    // Many small-promoteur ads have no project name — compose one so the form is submittable
    var projectName = (f.projectName || "").trim();
    if (!projectName) {
      projectName = [promoteur, (f.location || "").trim()].filter(Boolean).join(" – ");
    }
    setAddPrefill({
      projectName: projectName,
      location: (f.location || "").trim(),
      promoteur: promoteur,
      promoteurKey: promoteur.toLowerCase(),
      promoteurFull: promoteur,
      contactName: (f.contactName || "").trim(),
      phone: (f.phone || "").trim(),
      units: (f.units || "").trim(),
      unitDetails: (f.unitDetails || "").trim(),
      amenities: (f.amenities || "").trim(),
      region: regions.indexOf(region) !== -1 ? region : "",
      notes: ((f.notes || "").trim() + "\n\n--- Source text ---\n" + (rawText || "")).trim(),
    });
    setShowPaste(null);
    setShowAdd(true);
  }

  // Single match: merge into a draft and open EditForm for review before saving.
  function handleUpdateExisting(lead, fields, rawText) {
    var merged = mergeExtractedIntoLead(lead, fields, rawText, regions);
    setShowPaste(null);
    setSharedImg(null);
    setEditLead(lead);
    setEditDraft(merged);
    setSyncContact(false);
  }

  // Multiple projects: write creations + non-destructive merges in one batch.
  async function handleBatchApply(items) {
    var batch = writeBatch(db);
    items.forEach(function(item){
      if (item.match) {
        var merged = mergeExtractedIntoLead(item.match, item.fields, null, regions);
        delete merged.id;
        // An AI update fills text fields — it must never write back call/meeting
        // logs from an in-memory copy (could overwrite entries added since load).
        delete merged.callLog;
        delete merged.meetingLog;
        batch.update(doc(db, "leads", String(item.match.id)), merged);
      } else {
        batch.set(doc(collection(db, "leads")), buildLeadFromExtracted(item.fields, regions));
      }
    });
    await batch.commit();
    setShowPaste(null);
    setSharedImg(null);
  }

  // ── Settings persistence ───────────────────────────────────────────────────
  useEffect(function() { saveSettingsLS(settings); }, [settings]);

  // ── Follow-up notifications (browser, when the CRM is opened on PC) ────────
  useEffect(function() {
    if (!settings.browserNotif) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!leads.length) return;
    var today = new Date().toISOString().split("T")[0];
    var lastNotif = "";
    try { lastNotif = localStorage.getItem("synregis_last_notif") || ""; } catch(e) {}
    if (lastNotif === today) return;
    var now = new Date();
    var parts = (settings.notifTime || "09:00").split(":");
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return;
    var due = leads.filter(function(l) {
      return l.nextFollowUp && l.nextFollowUp <= today && l.pipelineStage !== "Lost" && l.pipelineStage !== "Unwanted";
    });
    if (due.length > 0) {
      try {
        new Notification("SynRegis Follow-Up", {
          body: due.length + " project" + (due.length > 1 ? "s need" : " needs") + " follow-up today",
          icon: "/logo.png"
        });
        localStorage.setItem("synregis_last_notif", today);
      } catch(e) {}
    }
  }, [leads, settings]);

  // ── Phone notifications (Android app): push data to the native scheduler ──
  // The wrapper stores the snapshot and fires a daily alarm at notifTime,
  // fully offline, even with the app closed.
  useEffect(function() {
    if (!leads.length) return;
    // Only ever push reminders built from the full, live dataset. A partial/cached
    // load must NEVER overwrite the phone's alarms with a shrunken list — that's
    // how follow-up reminders silently disappeared before.
    if (!synced) return;
    if (!window.SynRegisNative || !window.SynRegisNative.scheduleReminders) return;
    var followUps = leads
      .filter(function(l){ return l.nextFollowUp && l.pipelineStage !== "Lost" && l.pipelineStage !== "Unwanted"; })
      .map(function(l){ return { name: l.projectName, date: l.nextFollowUp }; });
    var staleNames = leads
      .filter(function(l){ return staleDays(l) !== null; })
      .map(function(l){ return l.projectName; });
    var payload = {
      enabled: !!settings.appNotif,
      time: settings.notifTime || "09:00",
      includeStale: !!settings.appNotifStale,
      followUps: followUps,
      staleNames: staleNames,
    };
    try { window.SynRegisNative.scheduleReminders(JSON.stringify(payload)); } catch(e) {}
  }, [leads, settings, synced]);

  // ── Automatic cloud backups (Firestore `backups/{date}`) ──────────────────
  // A full snapshot of every lead is written once per day and again whenever the
  // app is closed/backgrounded, so any accidental deletion or bad edit is always
  // recoverable from Settings → Backups. Only ever backs up a CONFIRMED-synced,
  // non-empty dataset — a partial load can never overwrite a good backup.
  var leadsRef = useRef(leads);
  var syncedRef = useRef(synced);
  useEffect(function(){ leadsRef.current = leads; syncedRef.current = synced; }, [leads, synced]);
  var lastBackupDay = useRef("");

  async function writeBackup(reason) {
    var cur = leadsRef.current;
    if (!syncedRef.current || !cur || !cur.length) return; // never back up partial/empty data
    var day = new Date().toISOString().split("T")[0];
    try {
      await setDoc(doc(db, "backups", day), {
        date: day,
        savedAt: new Date().toISOString(),
        reason: reason || "auto",
        count: cur.length,
        leads: cur,
      });
      lastBackupDay.current = day;
      // Keep the last 30 daily snapshots; prune older ones (only on the daily
      // write — no need to re-scan on every app-close).
      if (reason === "daily") {
        try {
          var all = await getDocs(collection(db, "backups"));
          var ids = all.docs.map(function(d){ return d.id; }).sort();
          if (ids.length > 30) {
            var batch = writeBatch(db);
            ids.slice(0, ids.length - 30).forEach(function(id){ batch.delete(doc(db, "backups", id)); });
            await batch.commit();
          }
        } catch(e) { /* pruning is best-effort */ }
      }
    } catch(e) { console.error("Backup failed:", e); }
  }

  // Daily: one snapshot per day, once the live data has synced.
  useEffect(function() {
    if (!synced || !leads.length) return;
    var day = new Date().toISOString().split("T")[0];
    if (lastBackupDay.current === day) return;
    writeBackup("daily");
  }, [synced, leads]); // eslint-disable-line react-hooks/exhaustive-deps

  // On app close/background: capture the latest state. visibilitychange→hidden is
  // the reliable signal on mobile (fires when backgrounded, page still alive).
  useEffect(function() {
    function onHide() { if (document.visibilityState === "hidden") writeBackup("close"); }
    function onPageHide() { writeBackup("close"); }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return function() {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadBackups() {
    var snap = await getDocs(collection(db, "backups"));
    return snap.docs
      .map(function(d){ return d.data(); })
      .sort(function(a, b){ return (b.savedAt || b.date || "").localeCompare(a.savedAt || a.date || ""); });
  }

  // Restore is NON-destructive: it re-adds/reverts every lead in the snapshot
  // (resurrecting anything deleted) but never removes leads created since.
  async function restoreBackup(backup) {
    if (!backup || !backup.leads || !backup.leads.length) throw new Error("This backup is empty.");
    var batch = writeBatch(db);
    backup.leads.forEach(function(l){
      var body = Object.assign({}, l);
      delete body.id;
      batch.set(doc(db, "leads", String(l.id)), body, { merge: true });
    });
    await batch.commit();
  }

  // ── System back button: close the top layer instead of quitting the app ──
  // While any modal or the detail view is open, keep one sentinel entry in the
  // history. Back pops the sentinel → we close the top-most layer and re-arm
  // if layers remain. Closing everything via the UI consumes the sentinel.
  var layers = [];
  if (showFilters) layers.push(function(){ setShowFilters(false); });
  if (showPaste !== null) layers.push(function(){ setShowPaste(null); setSharedImg(null); });
  if (showSettings)     layers.push(function(){ setShowSettings(false); });
  if (showExport !== null) layers.push(function(){ setShowExport(null); });
  if (showEditRegions)  layers.push(function(){ setShowEditRegions(false); });
  if (callLogLead)      layers.push(function(){ setCallLogLead(null); });
  if (meetingLogLead)   layers.push(function(){ setMeetingLogLead(null); });
  if (editLead)         layers.push(function(){ setEditLead(null); setEditDraft(null); setSyncContact(false); });
  if (showAdd)          layers.push(function(){ setShowAdd(false); });
  if (selected)         layers.push(function(){ setSelected(null); });
  layersRef.current = layers;

  useEffect(function() {
    var anyOpen = layersRef.current.length > 0;
    if (anyOpen && !backArmed.current) {
      window.history.pushState({ synregisLayer: true }, "");
      backArmed.current = true;
    } else if (!anyOpen && backArmed.current) {
      backArmed.current = false;
      window.history.back();
    }
  });

  useEffect(function() {
    function onPop() {
      if (layersRef.current.length > 0) {
        backArmed.current = false;
        layersRef.current[0]();
      }
    }
    window.addEventListener("popstate", onPop);
    return function(){ window.removeEventListener("popstate", onPop); };
  }, []);

  async function saveRegions(list) {
    setRegions(list);
    setShowEditRegions(false);
    try { await setDoc(doc(db, "config", "app"), { regions: list }, { merge: true }); } catch(e) {}
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  var filtered = leads.filter(function(l) {
    var q = search.toLowerCase();
    var matchQ = !q || l.projectName.toLowerCase().includes(q) || l.promoteur.toLowerCase().includes(q) || (l.location||"").toLowerCase().includes(q);
    var matchP = filterPipeline === "All" || l.pipelineStage === filterPipeline;
    var matchPr  = filterPriority === "All" || l.priority === filterPriority;
    var matchSt  = filterStage === "All" || l.projectStage === filterStage;
    var matchReg = filterRegion === "All" || l.region === filterRegion;
    var matchMiss = filterMissing === "All" || !String(l[filterMissing] || "").trim();
    var archived = l.pipelineStage === "Lost" || l.pipelineStage === "Unwanted";
    if (showArchive) return archived && matchQ;
    return !archived && matchQ && matchP && matchPr && matchSt && matchReg && matchMiss;
  });

  function setFilter(category, value) {
    if (category === "clearAll") {
      setFilterPriority("All"); setFilterStage("All"); setFilterRegion("All"); setFilterMissing("All");
    }
    else if (category === "priority") setFilterPriority(value);
    else if (category === "stage")    setFilterStage(value);
    else if (category === "region")   setFilterRegion(value);
    else if (category === "missing")  setFilterMissing(value);
  }
  var activeFilters = [];
  if (filterPriority !== "All") activeFilters.push({ cat:"priority", label: filterPriority });
  if (filterStage !== "All")    activeFilters.push({ cat:"stage",    label: filterStage });
  if (filterRegion !== "All")   activeFilters.push({ cat:"region",   label: filterRegion });
  if (filterMissing !== "All")  activeFilters.push({ cat:"missing",  label: (MISSING_FIELDS.find(function(m){ return m.key === filterMissing; }) || { label: filterMissing }).label });

  var counts = {};
  PIPELINE_STAGES.forEach(function(s) {
    counts[s] = leads.filter(function(l) { return l.pipelineStage === s; }).length;
  });

  var selFull = selected
    ? leads.find(function(l) { return l.id === selected.id; }) || selected
    : null;

  var editRelatedCount = editDraft && editDraft.promoteurKey && editDraft.promoteurKey.length > 2
    ? leads.filter(function(l) { return l.id !== editDraft.id && l.promoteurKey === editDraft.promoteurKey; }).length
    : 0;

  // ── Mutations (all write to Firestore) ────────────────────────────────────
  function startEdit(lead) {
    setEditLead(lead);
    setEditDraft({ ...lead });
    setSyncContact(false);
  }

  async function deleteLead(id) {
    await deleteDoc(doc(db, "leads", String(id)));
    setSelected(null);
  }

  async function saveEdit() {
    var draft = editDraft;
    try {
      // NEVER write callLog/meetingLog from the edit form — it doesn't touch them,
      // and writing back an in-memory copy could overwrite log entries added since
      // this lead was loaded (how the Kaela text log was lost). Logs are mutated
      // only by their own server-authoritative add/edit/delete paths.
      var fields = { ...draft };
      delete fields.callLog;
      delete fields.meetingLog;
      delete fields.id;
      await updateDoc(doc(db, "leads", String(draft.id)), fields);
      if (syncContact && draft.promoteurKey && draft.promoteurKey.length > 2) {
        var toSync = leads.filter(function(l) {
          return String(l.id) !== String(draft.id) && l.promoteurKey === draft.promoteurKey;
        });
        if (toSync.length > 0) {
          var batch = writeBatch(db);
          toSync.forEach(function(l) {
            batch.update(doc(db, "leads", String(l.id)), {
              contactName: draft.contactName,
              phone: draft.phone,
              notes: draft.notes,
            });
          });
          await batch.commit();
        }
      }
    } catch(e) { console.error("Save failed:", e); }
    setEditLead(null);
    setEditDraft(null);
    setSyncContact(false);
  }

  async function addLead(lead) {
    try {
      var ref = await addDoc(collection(db, "leads"), lead);
      setShowAdd(false);
      setAddPrefill(null);
      setSelected({ ...lead, id: ref.id });
    } catch(e) { console.error("Add failed:", e); }
  }

  async function addCallEntry(entry) {
    var pKey = callLogLead.promoteurKey;
    var cId  = callLogLead.id;
    var syncAll = pKey && pKey.length > 2;
    var toUpdate = syncAll
      ? leads.filter(function(l) { return l.promoteurKey === pKey; })
      : leads.filter(function(l) { return String(l.id) === String(cId); });
    try {
      var batch = writeBatch(db);
      toUpdate.forEach(function(l) {
        batch.update(doc(db, "leads", String(l.id)), { callLog: arrayUnion(entry) });
      });
      await batch.commit();
    } catch(e) { console.error("Call log failed:", e); }
    // Optimistic update for the open modal
    setCallLogLead(function(prev) {
      return { ...prev, callLog: [...(prev.callLog || []), entry] };
    });
  }

  async function addMeetingEntry(entry) {
    var pKey = meetingLogLead.promoteurKey;
    var cId  = meetingLogLead.id;
    var syncAll = pKey && pKey.length > 2;
    var toUpdate = syncAll
      ? leads.filter(function(l) { return l.promoteurKey === pKey; })
      : leads.filter(function(l) { return String(l.id) === String(cId); });
    try {
      var batch = writeBatch(db);
      toUpdate.forEach(function(l) {
        batch.update(doc(db, "leads", String(l.id)), { meetingLog: arrayUnion(entry) });
      });
      await batch.commit();
    } catch(e) { console.error("Meeting log failed:", e); }
    setMeetingLogLead(function(prev) {
      return { ...prev, meetingLog: [...(prev.meetingLog || []), entry] };
    });
  }

  // Edit (updated != null) or delete (updated == null) a call/meeting log entry.
  // Mirrors the add behavior: applies to all projects sharing the promoteurKey.
  async function mutateLogEntry(field, modalLead, setModalLead, orig, updated) {
    var pKey = modalLead.promoteurKey;
    var syncAll = pKey && pKey.length > 2;
    var targets = syncAll
      ? leads.filter(function(l){ return l.promoteurKey === pKey; })
      : leads.filter(function(l){ return String(l.id) === String(modalLead.id); });
    try {
      // Server-authoritative edit/delete: arrayRemove/arrayUnion operate on
      // Firestore's CURRENT array, so changing one entry can never overwrite other
      // entries added since this lead was loaded. (The old code rewrote the whole
      // array from in-memory state — a stale copy there silently dropped entries.)
      await Promise.all(targets.map(async function(l){
        var ref = doc(db, "leads", String(l.id));
        var patchDel = {}; patchDel[field] = arrayRemove(orig);
        await updateDoc(ref, patchDel);
        if (updated) {
          var patchAdd = {}; patchAdd[field] = arrayUnion(updated);
          await updateDoc(ref, patchAdd);
        }
      }));
    } catch(e) { console.error("Log edit failed:", e); }
    setModalLead(function(prev){
      if (!prev) return prev;
      var arr = (prev[field] || []).slice();
      var idx = arr.findIndex(function(e){ return e.date === orig.date && e.note === orig.note; });
      if (idx !== -1) { if (updated) arr[idx] = updated; else arr.splice(idx, 1); }
      var nextLead = { ...prev }; nextLead[field] = arr;
      return nextLead;
    });
  }

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        height:"100vh", background:NAVY, color:CREAM, fontFamily:"Inter, -apple-system, sans-serif", gap:16 }}>
        <div style={{ fontSize:22, color:GOLD, fontWeight:700 }}>SynRegis CRM</div>
        <div style={{ fontSize:14, color:MUTED }}>Connecting to database…</div>
        <div style={{ width:40, height:40, border:"3px solid "+BORDER, borderTop:"3px solid "+GOLD,
          borderRadius:"50%", animation:"spin 0.9s linear infinite" }}/>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <SplashScreen visible={showSplash} />
      <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:NAVY, color:CREAM, fontFamily:"Inter, -apple-system, sans-serif", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ background:NAVY, position:"relative", paddingBottom:isMobile?34:52, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:isMobile?"10px 14px 2px":"14px 28px 6px" }}>
          <img src={LOGO_SRC} alt="SynRegis" loading="eager" fetchPriority="high"
            onError={function(e){ if (e.target.src.indexOf("logo512")===-1) e.target.src="/logo512.png"; }}
            style={{ height:isMobile?46:78, width:"auto", objectFit:"contain", display:"block" }}/>
          <div style={{ display:"flex", alignItems:"flex-start", gap:isMobile?8:14 }}>
            <div style={{ textAlign:"right" }}>
              {!isMobile && <div style={{ fontSize:11, color:MUTED, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:2 }}>Pipeline CRM</div>}
              <div style={{ fontSize:isMobile?16:24, fontWeight:700, color:CREAM, lineHeight:1.1 }}>{leads.length} Projects</div>
              <div style={{ fontSize:isMobile?9:11, marginTop:2, color: synced ? "#10b981" : MUTED }}>
                {synced ? "✓ Synced" : (dbError ? "⚠ Offline — last saved" : "↻ Syncing…")}
              </div>
              <div style={{ fontSize:isMobile?10:12, color:MUTED, marginTop:3 }}>
                {leads.filter(function(l){return l.pipelineStage==="Won";}).length} Won
                &nbsp;|&nbsp;
                {leads.filter(function(l){return l.pipelineStage==="Negotiation";}).length} Negotiation
                &nbsp;|&nbsp;
                {leads.filter(function(l){return l.pipelineStage==="Prospecting";}).length} Prospecting
              </div>
            </div>
            <button onClick={function(){ setShowSettings(true); }} title="Settings"
              style={{ marginTop:4, background:"transparent", border:"1px solid "+BORDER, borderRadius:8, cursor:"pointer", padding:"7px 9px", color:GOLD, display:"flex", alignItems:"center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
        <svg viewBox="0 0 1440 56" preserveAspectRatio="none"
          style={{ position:"absolute", bottom:0, left:0, width:"100%", height:isMobile?36:56, display:"block" }}>
          <path d="M0,18 C160,52 320,0 480,26 C640,52 800,4 960,28 C1120,52 1280,8 1440,30 L1440,56 L0,56 Z" fill={CARD}/>
        </svg>
      </div>

      {/* Database connection banner — never let an empty/stale list look silent */}
      {dbError && (
        <div style={{ background: dbError==="permission-denied" ? "#ef444422" : "#f59e0b22",
          borderBottom:"1px solid "+(dbError==="permission-denied"?"#ef4444":"#f59e0b")+"66",
          color: dbError==="permission-denied"?"#fca5a5":"#fcd34d", padding:"8px 16px", fontSize:12, lineHeight:1.5, flexShrink:0 }}>
          {dbError==="permission-denied"
            ? "⚠ Database access was denied — check Firestore rules. Your data is safe in the cloud, not lost."
            : "⚠ Can't reach the database right now — showing your last saved data. Your leads are safe; this will refresh when you're back online."}
        </div>
      )}

      {/* App update banner (Android wrapper) */}
      {appUpdate && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 16px", background:GOLD+"22",
          borderBottom:"1px solid "+GOLD+"55", flexShrink:0 }}>
          <span style={{ flex:1, fontSize:12, color:GOLD, fontWeight:600 }}>
            Mise à jour disponible (v{appUpdate.versionName})
          </span>
          <button onClick={function(){
              try { window.SynRegisNative.installUpdate(appUpdate.url); } catch(e) {}
              setAppUpdate(null);
            }}
            style={{ padding:"5px 14px", borderRadius:6, border:"none", background:GOLD, color:NAVY,
              cursor:"pointer", fontSize:12, fontWeight:700, flexShrink:0 }}>
            Mettre à jour
          </button>
          <button onClick={function(){ setAppUpdate(null); }}
            style={{ background:"none", border:"none", color:MUTED, cursor:"pointer", fontSize:14, flexShrink:0 }}>✕</button>
        </div>
      )}

      {/* Stage filter bar */}
      <div style={{ display:"flex", gap:6, padding:"10px 16px", flexShrink:0, overflowX:"auto", background:CARD }}>
        {PIPELINE_STAGES.map(function(s){
          return (
            <div key={s} onClick={function(){ setFilterPipeline(filterPipeline===s?"All":s); }}
              style={{ flexShrink:0, padding:"5px 12px", borderRadius:99, fontSize:11, fontWeight:600, cursor:"pointer",
                background: filterPipeline===s ? PC[s] : PC[s]+"22",
                color: filterPipeline===s ? "#fff" : PC[s],
                border:"1px solid "+(filterPipeline===s?PC[s]:PC[s]+"44") }}>
              {s} ({counts[s]||0})
            </div>
          );
        })}
      </div>

      {/* Main layout */}
      <div style={{ display:"flex", flex:1, overflow:"hidden", position:"relative" }}>

        {/* Left: lead list */}
        <div style={{ width:isMobile?"100%":300, flexShrink:0, borderRight:isMobile?"none":"1px solid "+BORDER, display:"flex", flexDirection:"column", background:CARD }}>
          <div style={{ padding:"10px 12px", borderBottom:"1px solid "+BORDER, display:"flex", flexDirection:"column", gap:8 }}>
            <input value={search} onChange={function(e){setSearch(e.target.value);}}
              placeholder="Search projects..."
              style={{ background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"7px 10px", color:CREAM, fontSize:13, outline:"none" }}/>
            <div style={{ display:"flex", gap:6 }}>
              <div style={{ position:"relative", flex:1, minWidth:0 }}>
                <button onClick={function(){ setShowFilters(!showFilters); }}
                  style={{ width:"100%", padding:"7px 10px", borderRadius:6, textAlign:"left",
                    border:"1px solid "+(activeFilters.length?GOLD+"88":BORDER),
                    background:CARD2, color:activeFilters.length?GOLD:CREAM, cursor:"pointer", fontSize:12,
                    display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span>Filters{activeFilters.length ? " (" + activeFilters.length + ")" : ""}</span>
                  <span style={{ color:MUTED }}>▾</span>
                </button>
                <FilterMenu open={showFilters} onClose={function(){ setShowFilters(false); }}
                  leads={leads} regions={regions}
                  values={{ priority: filterPriority, stage: filterStage, region: filterRegion, missing: filterMissing }}
                  onChange={setFilter}/>
              </div>
              <button onClick={function(){ setAddPrefill(null); setShowAdd(true); }}
                style={{ padding:"7px 12px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontWeight:700, fontSize:12, flexShrink:0 }}>
                + Add
              </button>
              <button onClick={function(){ setShowPaste(""); }}
                title="Create a lead from pasted ad text (AI)"
                style={{ padding:"7px 10px", borderRadius:6, border:"1px solid "+GOLD+"66", background:"transparent", color:GOLD, cursor:"pointer", fontWeight:700, fontSize:12, flexShrink:0 }}>
                ✨ AI
              </button>
              <button onClick={function(){ setShowArchive(!showArchive); setSelected(null); }}
                style={{ padding:"7px 12px", borderRadius:6, border:"1px solid #ef444466", background:showArchive?"#ef4444":"transparent", color:showArchive?"#fff":"#ef4444", cursor:"pointer", fontSize:12, flexShrink:0 }}>
                {showArchive ? "← Pipeline" : "Archive"}
              </button>
            </div>
            {activeFilters.length > 0 && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {activeFilters.map(function(f){
                  return (
                    <span key={f.cat} onClick={function(){ setFilter(f.cat, "All"); }}
                      style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:99,
                        background:GOLD+"22", border:"1px solid "+GOLD+"55", color:GOLD, fontSize:11, cursor:"pointer" }}>
                      {f.label} ✕
                    </span>
                  );
                })}
              </div>
            )}
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={function(){ setGroupByProm(!groupByProm); }}
                title="Group projects by promoteur"
                style={{ flex:1, padding:"7px 10px", borderRadius:6, border:"1px solid "+(groupByProm?GOLD:BORDER), background:groupByProm?GOLD:CARD2, color:groupByProm?NAVY:MUTED, cursor:"pointer", fontSize:11, fontWeight:groupByProm?700:400 }}>
                Group by promoteur
              </button>
              <button onClick={function(){ setShowEditRegions(true); }}
                style={{ padding:"7px 10px", borderRadius:6, border:"1px solid "+BORDER, background:CARD2, color:MUTED, cursor:"pointer", fontSize:11, flexShrink:0 }}>
                Regions
              </button>
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto" }}>
            {(function(){
              var today = new Date().toISOString().split("T")[0];
              var dueLeads = leads.filter(function(l){ return l.nextFollowUp && l.nextFollowUp <= today && l.pipelineStage !== "Lost" && l.pipelineStage !== "Unwanted"; });
              return settings.banner && dueLeads.length > 0 && (
                <div style={{ margin:"8px 10px 4px", padding:"8px 12px", borderRadius:8, background:"#ef444422", border:"1px solid #ef444466" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#ef4444", marginBottom:4 }}>FOLLOW-UPS DUE</div>
                  {dueLeads.map(function(l){
                    var overdue = l.nextFollowUp < today;
                    return (
                      <div key={l.id} onClick={function(){ setSelected(l); }}
                        style={{ fontSize:12, color:CREAM, cursor:"pointer", padding:"2px 0", display:"flex", justifyContent:"space-between" }}>
                        <span>{l.projectName}</span>
                        <span style={{ color: overdue ? "#ef4444" : "#f59e0b", fontSize:11 }}>{overdue ? "Overdue" : "Today"}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {(function(){
              if (!settings.banner || !settings.stale) return null;
              var staleLeads = leads
                .map(function(l){ return { lead: l, days: staleDays(l) }; })
                .filter(function(x){ return x.days !== null; })
                .sort(function(a,b){ return b.days - a.days; });
              if (!staleLeads.length) return null;
              return (
                <div style={{ margin:"8px 10px 4px", padding:"8px 12px", borderRadius:8, background:"#f59e0b18", border:"1px solid #f59e0b55" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#f59e0b", marginBottom:4 }}>GOING QUIET ({staleLeads.length})</div>
                  {(quietExpanded ? staleLeads : staleLeads.slice(0,5)).map(function(x){
                    return (
                      <div key={x.lead.id} onClick={function(){ setSelected(x.lead); }}
                        style={{ fontSize:12, color:CREAM, cursor:"pointer", padding:"2px 0", display:"flex", justifyContent:"space-between" }}>
                        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingRight:8 }}>{x.lead.projectName}</span>
                        <span style={{ color:"#f59e0b", fontSize:11, flexShrink:0 }}>{x.days}d silent</span>
                      </div>
                    );
                  })}
                  {staleLeads.length > 5 && (
                    <div onClick={function(){ setQuietExpanded(!quietExpanded); }}
                      style={{ fontSize:11, fontWeight:600, color:"#f59e0b", marginTop:5, cursor:"pointer", userSelect:"none" }}>
                      {quietExpanded ? "▲ Show less" : "▼ Show all " + staleLeads.length + " — tap each to open"}
                    </div>
                  )}
                </div>
              );
            })()}
            {filtered.length===0
              ? <div style={{ padding:20, color:MUTED, fontSize:13, textAlign:"center" }}>No results</div>
              : groupByProm
                ? (function(){
                    var groups = {};
                    var order = [];
                    filtered.forEach(function(l){
                      var k = (l.promoteurKey && l.promoteurKey.length > 2) ? l.promoteurKey
                        : (l.promoteur || "").trim().toLowerCase() || "__none__";
                      if (!groups[k]) { groups[k] = []; order.push(k); }
                      groups[k].push(l);
                    });
                    order.sort(function(a,b){
                      if (groups[b].length !== groups[a].length) return groups[b].length - groups[a].length;
                      var na = (groups[a][0].promoteur || "zzz").toLowerCase();
                      var nb = (groups[b][0].promoteur || "zzz").toLowerCase();
                      return na < nb ? -1 : na > nb ? 1 : 0;
                    });
                    return order.map(function(k){
                      var g = groups[k];
                      return (
                        <div key={k}>
                          <div style={{ padding:"6px 14px", background:CARD2, borderBottom:"1px solid "+BORDER, position:"sticky", top:0, zIndex:5,
                            fontSize:11, fontWeight:700, color:GOLD, letterSpacing:"0.04em", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{g[0].promoteur || "No promoteur"}</span>
                            <span style={{ color:MUTED, flexShrink:0, marginLeft:8 }}>{g.length} project{g.length>1?"s":""}</span>
                          </div>
                          {g.map(function(l){
                            return <LeadRow key={l.id} lead={l} settings={settings} selected={selFull&&selFull.id===l.id} onSelect={function(x){ setSelected(x); }}/>;
                          })}
                        </div>
                      );
                    });
                  })()
                : filtered.map(function(l){
                    return <LeadRow key={l.id} lead={l} settings={settings} selected={selFull&&selFull.id===l.id} onSelect={function(x){ setSelected(x); }}/>;
                  })
            }
          </div>
          <div style={{ padding:"8px 12px", borderTop:"1px solid "+BORDER, fontSize:11, color:MUTED, textAlign:"center" }}>
            {filtered.length} of {leads.length} shown
            <button onClick={function(){exportData(leads, setShowExport);}} style={{ marginLeft:10, background:"none", border:"none", color:GOLD, cursor:"pointer", fontSize:11, textDecoration:"underline" }}>Export JSON</button>
          </div>
        </div>

        {/* Right: detail panel — hidden on mobile until a lead is selected, then fullscreen */}
        {(!isMobile || selFull) && (
          <div style={{ flex:1, display:"flex", flexDirection:"column", background:CARD, overflow:"hidden", ...(isMobile&&selFull?{position:"fixed",inset:0,zIndex:200,overflowY:"auto"}:{}) }}>
            {selFull
              ? <div style={{display:"flex", flexDirection:"column", height:"100%"}}>
                  <div style={{padding:"10px 16px", borderBottom:"1px solid "+BORDER, flexShrink:0}}>
                    <button onClick={function(){ setSelected(null); }} style={{padding:"6px 14px", borderRadius:6, border:"1px solid "+GOLD+"66", background:"transparent", color:GOLD, cursor:"pointer", fontSize:13}}>← Back</button>
                  </div>
                  <DetailPanel lead={selFull} allLeads={leads} onEdit={startEdit} onCallLog={setCallLogLead} onMeetingLog={setMeetingLogLead} onSelect={function(r){ setSelected(r); }} onDelete={deleteLead}/>
                </div>
              : <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:MUTED, fontSize:14 }}>Select a project to view details</div>
            }
          </div>
        )}
      </div>

      {/* Modals */}
      {showAdd && <AddForm allLeads={leads} regions={regions} initial={addPrefill} onAdd={addLead}
        onCancel={function(){ setShowAdd(false); setAddPrefill(null); }}/>}
      {showPaste !== null && (
        <PasteLeadModal
          initialText={showPaste}
          initialImage={sharedImg}
          geminiKey={geminiKey}
          regions={regions}
          allLeads={leads}
          onExtracted={function(fields, rawText){ setSharedImg(null); handleExtracted(fields, rawText); }}
          onUpdateExisting={handleUpdateExisting}
          onBatchApply={handleBatchApply}
          onClose={function(){ setShowPaste(null); setSharedImg(null); }}
        />
      )}
      {editLead && editDraft && (
        <EditForm
          lead={editDraft}
          setLead={setEditDraft}
          onSave={saveEdit}
          onCancel={function(){ setEditLead(null); setEditDraft(null); setSyncContact(false); }}
          syncContact={syncContact}
          setSyncContact={setSyncContact}
          relatedCount={editRelatedCount}
          allLeads={leads}
          regions={regions}
        />
      )}
      {callLogLead && (
        <CallLogModal
          lead={callLogLead}
          allLeads={leads}
          onAdd={addCallEntry}
          onEditEntry={function(orig, updated){ mutateLogEntry("callLog", callLogLead, setCallLogLead, orig, updated); }}
          onClose={function(){ setCallLogLead(null); }}
        />
      )}
      {meetingLogLead && (
        <MeetingLogModal
          lead={meetingLogLead}
          allLeads={leads}
          onAdd={addMeetingEntry}
          onEditEntry={function(orig, updated){ mutateLogEntry("meetingLog", meetingLogLead, setMeetingLogLead, orig, updated); }}
          onClose={function(){ setMeetingLogLead(null); }}
        />
      )}
      {showEditRegions && (
        <RegionEditModal
          regions={regions}
          onSave={saveRegions}
          onClose={function(){ setShowEditRegions(false); }}
        />
      )}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={function(s){ setSettings(s); }}
          onClose={function(){ setShowSettings(false); }}
          geminiKey={geminiKey}
          onSaveGeminiKey={saveGeminiKey}
          onLoadBackups={loadBackups}
          onRestore={restoreBackup}
          leadCount={leads.length}
          canInstall={!!installEvt}
          onInstall={installPwa}
        />
      )}
      {showExport !== null && (
        <ExportModal text={showExport} count={leads.length} onClose={function(){ setShowExport(null); }} />
      )}
    </div>
    </>
  );
}

export default function App() {
  return <Gate><AppInner /></Gate>;
}
