import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  writeBatch,
  arrayUnion,
} from "firebase/firestore";

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
const db = getFirestore(fbApp);

// ── Design tokens ─────────────────────────────────────────────────────────────
const NAVY   = "#08111f";
const CARD   = "#0e1e35";
const CARD2  = "#122540";
const GOLD   = "#c4a96b";
const CREAM  = "#f0ece4";
const MUTED  = "#6b8aaa";
const BORDER = "#1c3550";
const INP    = "#091525";

const PIPELINE_STAGES = ["Prospecting","Proposal Sent","Negotiation","Due Diligence","Won","Lost","On Hold"];
const PROJECT_STAGES  = ["Pre-Launch/Off-Plan","Permitting & Planning","Under Construction","Finishing Works","Near Delivery","Delivered & Occupied","Stalled/Suspended"];
const PRIORITIES      = ["Top Priority","High","Warm","Cold","Inbound Only"];

const PC = {
  "Prospecting":"#6b7280","Proposal Sent":"#3b82f6","Negotiation":"#8b5cf6",
  "Due Diligence":"#f59e0b","Won":"#10b981","Lost":"#ef4444","On Hold":"#9ca3af",
};
const PRC = {
  "Top Priority":"#ef4444","High":"#f59e0b","Warm":"#f97316","Cold":"#6b8aaa","Inbound Only":"#3b82f6",
};

const LOGO_SRC = "/logo.png";

// ── Export helper ─────────────────────────────────────────────────────────────
function exportData(leads) {
  try {
    var s = JSON.stringify(leads, null, 2);
    var a = document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(s);
    a.download = "synregis_leads.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) { alert("Export failed: " + e.message); }
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
          {props.relatedCount > 0 && (
            <div
              onClick={function(){ props.setSyncContact(!props.syncContact); }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
                background:GOLD+"11", borderRadius:6, border:"1px solid "+GOLD+"33",
                marginBottom:14, cursor:"pointer" }}>
              <input type="checkbox" checked={props.syncContact} readOnly
                style={{ accentColor:GOLD, width:14, height:14, cursor:"pointer" }}/>
              <span style={{ fontSize:12, color:GOLD }}>
                Apply contact &amp; phone to {props.relatedCount} other {lead.promoteur} project{props.relatedCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
          <Fld label="Units (total)" value={lead.units} onChange={f("units")}/>
          <Fld label="Unit Details" value={lead.unitDetails} onChange={f("unitDetails")} type="textarea"/>
          <Fld label="Amenities" value={lead.amenities} onChange={f("amenities")} type="textarea"/>
          <Fld label="Project Stage" value={lead.projectStage} onChange={f("projectStage")} type="select" options={PROJECT_STAGES}/>
          <Fld label="Pipeline Stage" value={lead.pipelineStage} onChange={f("pipelineStage")} type="select" options={PIPELINE_STAGES}/>
          <Fld label="Priority" value={lead.priority} onChange={f("priority")} type="select" options={PRIORITIES}/>
          <Fld label="Next Follow-Up" value={lead.nextFollowUp} onChange={f("nextFollowUp")} type="date"/>
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
    priority:PRIORITIES[2], notes:"", callLog:[], nextFollowUp:"", createdAt:""
  };
  var [form, setForm] = useState(blank);
  function f(k) { return function(v){ setForm(function(p){ return {...p,[k]:v}; }); }; }
  var ovl = { position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" };
  var sht = { background:CARD, border:"1px solid "+BORDER, borderRadius:12, width:"92%", maxWidth:560, maxHeight:"92vh", display:"flex", flexDirection:"column", overflow:"hidden" };
  function submit() {
    if (!form.projectName.trim()) return;
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
          <Fld label="Units (total)" value={form.units} onChange={f("units")}/>
          <Fld label="Unit Details" value={form.unitDetails} onChange={f("unitDetails")} type="textarea"/>
          <Fld label="Amenities" value={form.amenities} onChange={f("amenities")} type="textarea"/>
          <Fld label="Project Stage" value={form.projectStage} onChange={f("projectStage")} type="select" options={PROJECT_STAGES}/>
          <Fld label="Pipeline Stage" value={form.pipelineStage} onChange={f("pipelineStage")} type="select" options={PIPELINE_STAGES}/>
          <Fld label="Priority" value={form.priority} onChange={f("priority")} type="select" options={PRIORITIES}/>
          <Fld label="Next Follow-Up" value={form.nextFollowUp} onChange={f("nextFollowUp")} type="date"/>
          <Fld label="Notes" value={form.notes} onChange={f("notes")} type="textarea"/>
        </div>
        <div style={{ padding:"14px 20px", borderTop:"1px solid "+BORDER, flexShrink:0, display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button style={{ padding:"8px 20px", borderRadius:6, border:"1px solid "+BORDER, background:CARD2, color:CREAM, cursor:"pointer", fontSize:13 }} onClick={props.onCancel}>Cancel</button>
          <button style={{ padding:"8px 20px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:13, fontWeight:700 }} onClick={submit}>Add Lead</button>
        </div>
      </div>
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
                return (
                  <div key={i} style={{ marginBottom:10, padding:"8px 12px", background:CARD2, borderRadius:6, borderLeft:"3px solid "+GOLD }}>
                    <div style={{ fontSize:11, color:MUTED, marginBottom:3 }}>{e.date}</div>
                    <div style={{ fontSize:13, color:CREAM }}>{e.note}</div>
                  </div>
                );
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

function DetailPanel(props) {
  var lead = props.lead;
  var allLeads = props.allLeads;
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
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:CREAM, marginBottom:6 }}>{lead.projectName}</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <Badge label={lead.pipelineStage} bg={PC[lead.pipelineStage]||MUTED}/>
            <Badge label={lead.priority} bg={PRC[lead.priority]||MUTED}/>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={function(){ props.onCallLog(lead); }}
            style={{ padding:"6px 12px", borderRadius:6, border:"1px solid "+GOLD+"66", background:"transparent", color:GOLD, cursor:"pointer", fontSize:12 }}>
            + Call Log
          </button>
          <button onClick={function(){ props.onEdit(lead); }}
            style={{ padding:"6px 14px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontSize:12, fontWeight:700 }}>
            Edit
          </button>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px" }}>
        <div style={sec}><div style={lbl}>Location</div><div style={val}>{lead.location||"-"}</div></div>
        <div style={sec}><div style={lbl}>Promoteur</div><div style={val}>{lead.promoteur||"-"}</div></div>
        <div style={sec}><div style={lbl}>Contact</div><div style={val}>{lead.contactName||"-"}</div></div>
        <div style={sec}><div style={lbl}>Phone</div><div style={val}>{lead.phone||"-"}</div></div>
        <div style={sec}><div style={lbl}>Total Units</div><div style={val}>{lead.units||"-"}</div></div>
        <div style={sec}><div style={lbl}>Project Stage</div><div style={val}>{lead.projectStage||"-"}</div></div>
        {lead.nextFollowUp && (<div style={sec}><div style={lbl}>Next Follow-Up</div><div style={val}>{lead.nextFollowUp}</div></div>)}
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
          <div style={lbl}>Recent Calls ({lead.callLog.length})</div>
          {lead.callLog.slice(-3).reverse().map(function(e,i){
            return (
              <div key={i} style={{ padding:"7px 10px", background:CARD2, borderRadius:5, borderLeft:"3px solid "+GOLD, marginBottom:6 }}>
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

function LeadRow(props) {
  var lead = props.lead;
  var sel = props.selected;
  return (
    <div onClick={function(){ props.onSelect(lead); }}
      style={{
        padding:"12px 14px", cursor:"pointer", borderBottom:"1px solid "+BORDER,
        background: sel ? CARD2 : "transparent",
        borderLeft: sel ? "3px solid "+GOLD : "3px solid transparent"
      }}
      onMouseEnter={function(e){ if(!sel) e.currentTarget.style.background=CARD2+"88"; }}
      onMouseLeave={function(e){ if(!sel) e.currentTarget.style.background="transparent"; }}>
      <div style={{ fontWeight:600, fontSize:13, color:CREAM, marginBottom:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
        {lead.projectName}
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
export default function App() {
  var [leads, setLeads]               = useState([]);
  var [loading, setLoading]           = useState(true);
  var [selected, setSelected]         = useState(null);
  var [search, setSearch]             = useState("");
  var [filterPipeline, setFilterPipeline] = useState("All");
  var [filterPriority, setFilterPriority] = useState("All");
  var [showAdd, setShowAdd]           = useState(false);
  var [editLead, setEditLead]         = useState(null);
  var [editDraft, setEditDraft]       = useState(null);
  var [syncContact, setSyncContact]   = useState(false);
  var [callLogLead, setCallLogLead]   = useState(null);

  // ── Firestore real-time subscription ──────────────────────────────────────
  useEffect(function() {
    var leadsCol = collection(db, "leads");
    var unsub = onSnapshot(leadsCol,
      async function(snap) {
        if (snap.empty) {
          // First-time run: seed all 86 leads into Firestore
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
      },
      function(err) {
        console.error("Firestore error:", err);
        setLoading(false);
      }
    );
    return function() { unsub(); };
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────
  var filtered = leads.filter(function(l) {
    var q = search.toLowerCase();
    var matchQ = !q || l.projectName.toLowerCase().includes(q) || l.promoteur.toLowerCase().includes(q) || (l.location||"").toLowerCase().includes(q);
    var matchP = filterPipeline === "All" || l.pipelineStage === filterPipeline;
    var matchR = filterPriority === "All"  || l.priority === filterPriority;
    return matchQ && matchP && matchR;
  });

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

  async function saveEdit() {
    var draft = editDraft;
    try {
      await updateDoc(doc(db, "leads", String(draft.id)), draft);
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

  var dropSt = { background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"7px 10px", color:CREAM, fontSize:12, outline:"none" };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:NAVY, color:CREAM, fontFamily:"Inter, -apple-system, sans-serif", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ background:"#ffffff", position:"relative", paddingBottom:52, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 28px 6px" }}>
          <img src={LOGO_SRC} alt="SynRegis" style={{ height:78, width:"auto", objectFit:"contain", display:"block" }}/>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:11, color:"#999", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:2 }}>Pipeline CRM</div>
            <div style={{ fontSize:24, fontWeight:700, color:NAVY, lineHeight:1.1 }}>{leads.length} Projects</div>
            <div style={{ fontSize:12, color:"#888", marginTop:3 }}>
              {leads.filter(function(l){return l.pipelineStage==="Won";}).length} Won
              &nbsp;|&nbsp;
              {leads.filter(function(l){return l.pipelineStage==="Negotiation";}).length} Negotiation
              &nbsp;|&nbsp;
              {leads.filter(function(l){return l.pipelineStage==="Prospecting";}).length} Prospecting
            </div>
          </div>
        </div>
        <svg viewBox="0 0 1440 56" preserveAspectRatio="none"
          style={{ position:"absolute", bottom:0, left:0, width:"100%", height:56, display:"block" }}>
          <path d="M0,18 C160,52 320,0 480,26 C640,52 800,4 960,28 C1120,52 1280,8 1440,30 L1440,56 L0,56 Z" fill={CARD}/>
        </svg>
      </div>

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
        <div style={{ width:300, flexShrink:0, borderRight:"1px solid "+BORDER, display:"flex", flexDirection:"column", background:CARD }}>
          <div style={{ padding:"10px 12px", borderBottom:"1px solid "+BORDER, display:"flex", flexDirection:"column", gap:8 }}>
            <input value={search} onChange={function(e){setSearch(e.target.value);}}
              placeholder="Search projects..."
              style={{ background:INP, border:"1px solid "+BORDER, borderRadius:6, padding:"7px 10px", color:CREAM, fontSize:13, outline:"none" }}/>
            <div style={{ display:"flex", gap:6 }}>
              <select value={filterPriority} onChange={function(e){setFilterPriority(e.target.value);}} style={dropSt}>
                <option value="All">All Priorities</option>
                {PRIORITIES.map(function(p){ return <option key={p} value={p}>{p}</option>; })}
              </select>
              <button onClick={function(){ setShowAdd(true); }}
                style={{ padding:"7px 12px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontWeight:700, fontSize:12, flexShrink:0 }}>
                + Add
              </button>
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto" }}>
            {filtered.length===0
              ? <div style={{ padding:20, color:MUTED, fontSize:13, textAlign:"center" }}>No results</div>
              : filtered.map(function(l){
                  return <LeadRow key={l.id} lead={l} selected={selFull&&selFull.id===l.id} onSelect={function(x){ setSelected(x); }}/>;
                })
            }
          </div>
          <div style={{ padding:"8px 12px", borderTop:"1px solid "+BORDER, fontSize:11, color:MUTED, textAlign:"center" }}>
            {filtered.length} of {leads.length} shown
            <button onClick={function(){exportData(leads);}} style={{ marginLeft:10, background:"none", border:"none", color:GOLD, cursor:"pointer", fontSize:11, textDecoration:"underline" }}>Export JSON</button>
          </div>
        </div>

        {/* Right: detail panel */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", background:CARD, overflow:"hidden", ...(window.innerWidth<640&&selFull?{position:"fixed",inset:0,zIndex:200,overflowY:"auto"}:{}) }}>
          {selFull
            ? <DetailPanel lead={selFull} allLeads={leads} onEdit={startEdit} onCallLog={setCallLogLead} onSelect={function(r){ setSelected(r); }}/>
            : <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:MUTED, fontSize:14 }}>Select a project to view details</div>
          }
        </div>
      </div>

      {/* Modals */}
      {showAdd && <AddForm onAdd={addLead} onCancel={function(){ setShowAdd(false); }}/>}
      {editLead && editDraft && (
        <EditForm
          lead={editDraft}
          setLead={setEditDraft}
          onSave={saveEdit}
          onCancel={function(){ setEditLead(null); setEditDraft(null); setSyncContact(false); }}
          syncContact={syncContact}
          setSyncContact={setSyncContact}
          relatedCount={editRelatedCount}
        />
      )}
      {callLogLead && (
        <CallLogModal
          lead={callLogLead}
          allLeads={leads}
          onAdd={addCallEntry}
          onClose={function(){ setCallLogLead(null); }}
        />
      )}
    </div>
  );
}
