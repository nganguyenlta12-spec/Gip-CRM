import { useState, useEffect } from "react";
import * as XLSX from "xlsx";

// ── Constants ─────────────────────────────────────────────
const STAGES = ["Data Thô", "Freeze", "Cold", "Warm", "Hot", "Win"];
const PLATFORMS = ["Shopee", "Lazada", "TikTok Shop", "Website", "Khác"];
const PICS = ["GIPMANA", "GIP01", "GIP02", "GIP03", "GIP04", "GIP05", "GIP06"];
const BANG_GIA = ["GP01", "GP02", "GP03", "Enterprise", "Custom"];
const SOURCE_GROUPS = {
  "Cá nhân": ["Facebook", "Zalo", "Group", "Khách giới thiệu", "Khác"],
  "Sếp Loki": ["Facebook", "Zalo", "Group", "Khách giới thiệu", "Khác"],
};

// SLA: số ngày tối đa ở mỗi stage trước khi phải chuyển lên
const SLA_DAYS = {
  "Data Thô": 15,
  Freeze: 10,
  Cold: 7,
  Warm: 5,
  Hot: 3,
};
// Lịch gặp KH (ngày)
const MEETING_CADENCE = { Warm: 21, Hot: 21, Win: 30 };

const STAGE_CFG = {
  "Data Thô": { icon: "🗂️", color: "#6b7c93", border: "#c8d4e0", badge: "#eef2f6", head: "#f5f7fa" },
  Freeze:     { icon: "❄️", color: "#1a6fba", border: "#b3d4f0", badge: "#e8f3fc", head: "#f0f7ff" },
  Cold:       { icon: "🌊", color: "#0e5fa3", border: "#90c0ef", badge: "#ddeefa", head: "#eaf5ff" },
  Warm:       { icon: "☀️", color: "#b86e00", border: "#f0cc80", badge: "#fff8e6", head: "#fffbf0" },
  Hot:        { icon: "🔥", color: "#c0392b", border: "#f0a898", badge: "#fdecea", head: "#fff5f4" },
  Win:        { icon: "🏆", color: "#1a7a45", border: "#80d0a8", badge: "#e6f8ee", head: "#f0fdf6" },
};

// ── Helpers ───────────────────────────────────────────────
const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
const fmtDT = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const monthKey = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const monthLabel = (key) => { if (!key) return ""; const [y,m] = key.split("-"); return `Tháng ${parseInt(m)}/${y}`; };
const parseNotes = (notes) => Array.isArray(notes) ? notes : [];
const toISODate = (ddmmyyyy) => { if (!ddmmyyyy) return ""; const [d,m,y] = ddmmyyyy.split("/"); return y && m && d ? `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}` : ""; };
const toDisplayDate = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };

// SLA: tính số ngày đã ở stage hiện tại
const daysInStage = (deal) => {
  const hist = Array.isArray(deal.stageHistory) ? deal.stageHistory : [];
  const last = [...hist].reverse().find(h => h.to === deal.stage);
  const since = last ? last.date : (deal.dataInputDate || deal.createdAt);
  return daysBetween(since, new Date().toISOString());
};
const slaStatus = (deal) => {
  if (deal.stage === "Win") return null;
  const max = SLA_DAYS[deal.stage];
  if (!max) return null;
  const days = daysInStage(deal);
  if (days > max) return { label: `Quá hạn ${days - max}n`, type: "overdue" };
  if (days >= max - 1) return { label: `Hết hạn hôm nay`, type: "warning" };
  if (days >= max * 0.7) return { label: `Còn ${max - days}n`, type: "caution" };
  return null;
};
const meetingStatus = (deal) => {
  const cadence = MEETING_CADENCE[deal.stage];
  if (!cadence || !deal.lastMeeting) return null;
  const days = daysBetween(deal.lastMeeting, new Date().toISOString());
  const due = cadence - days;
  if (due <= 0) return { label: `Gặp KH quá hạn ${-due}n`, type: "overdue" };
  if (due <= 3) return { label: `Gặp KH trong ${due}n`, type: "warning" };
  return null;
};

// ── Owner detection from URL ──────────────────────────────
const getOwnerFromURL = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("owner") || "";
};

// ── Google Apps Script code ───────────────────────────────
const SCRIPT_CODE = `// ═══ GIP Pipeline - Google Apps Script ═══
// Dán code này vào Apps Script, deploy as Web App

// ⚙️ CẤU HÌNH TELEGRAM (điền vào đây)
var TELEGRAM_BOT_TOKEN = "YOUR_BOT_TOKEN"; // lấy từ @BotFather
var TELEGRAM_CHATS = {
  "GIPMANA": "CHAT_ID_GIPMANA",
  "GIP01": "CHAT_ID_GIP01",
  "GIP02": "CHAT_ID_GIP02",
  "GIP03": "CHAT_ID_GIP03",
  "GIP04": "CHAT_ID_GIP04",
  "GIP05": "CHAT_ID_GIP05",
  "GIP06": "CHAT_ID_GIP06",
};
var SLA_DAYS = {"Data Thô":15,"Freeze":10,"Cold":7,"Warm":5,"Hot":3};
var MEETING_DAYS = {"Warm":21,"Hot":21,"Win":30};

function doGet(e){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sh=ss.getSheetByName("Pipeline")||ss.getActiveSheet();
  var act=e.parameter.action;
  if(act==="sync"){
    var deals=JSON.parse(decodeURIComponent(escape(atob(e.parameter.data))));
    sh.clearContents();
    sh.appendRow(["ID","Brand","Contact","Phone","Platform","Stage","PIC","Source","Value","MaKH","BangGia","DataInputDate","LastMeeting","Notes","Created","Updated","StageHistory"]);
    deals.forEach(function(d){
      var notesText=Array.isArray(d.notes)?d.notes.map(function(n){return "["+n.date+"]: "+n.text;}).join(" || "):"";
      sh.appendRow([d.id,d.brand||"",d.contact||"",d.phone||"",
        Array.isArray(d.platform)?d.platform.join(", "):d.platform||"",
        d.stage||"",d.pic||"",d.source||"",d.value||"",
        d.maKH||"",d.bangGia||"",d.dataInputDate||"",d.lastMeeting||"",
        notesText,d.createdAt||"",d.updatedAt||"",JSON.stringify(d.stageHistory||[])]);
    });
    return out({success:true,count:deals.length});
  }
  if(act==="read"){
    var data=sh.getDataRange().getValues();
    if(data.length<=1)return out({deals:[]});
    var keys=["id","brand","contact","phone","platform","stage","pic","source","value","maKH","bangGia","dataInputDate","lastMeeting","notes","createdAt","updatedAt","stageHistory"];
    var rows=data.slice(1).map(function(r){var o={};keys.forEach(function(k,i){o[k]=String(r[i]||"")});return o});
    return out({deals:rows});
  }
  return out({error:"Unknown action"});
}
function out(d){return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);}

// ═══ Hàm gửi Telegram notification (chạy theo trigger hàng ngày) ═══
function checkAndNotify(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sh=ss.getSheetByName("Pipeline")||ss.getActiveSheet();
  var data=sh.getDataRange().getValues();
  if(data.length<=1)return;
  var keys=data[0].map(function(k){return String(k).toLowerCase();});
  var now=new Date();
  var msgs={};
  PICS.forEach(function(p){msgs[p]=[];});
  data.slice(1).forEach(function(row){
    var d={};keys.forEach(function(k,i){d[k]=String(row[i]||"")});
    if(!d.pic||!TELEGRAM_CHATS[d.pic])return;
    var pic=d.pic;
    // SLA check
    var maxDays=SLA_DAYS[d.stage];
    if(maxDays&&d.stage!=="Win"){
      var hist=[];try{hist=JSON.parse(d.stagehistory||"[]");}catch(e){}
      var last=null;for(var i=hist.length-1;i>=0;i--){if(hist[i].to===d.stage){last=hist[i].date;break;}}
      var since=last||(d.datainputdate||d.created);
      var days=Math.round((now-new Date(since))/86400000);
      if(days>maxDays){msgs[pic].push("⚠️ SLA QUÁHẠN: *"+d.brand+"* đang ở "+d.stage+" đã "+days+" ngày (max "+maxDays+"n)");}
    }
    // Meeting check
    var cadence=MEETING_DAYS[d.stage];
    if(cadence&&d.lastmeeting){
      var daysSince=Math.round((now-new Date(d.lastmeeting))/86400000);
      if(daysSince>=cadence){msgs[pic].push("📅 GẶP KH: *"+d.brand+"* ("+d.stage+") đã "+daysSince+" ngày chưa gặp (cần gặp mỗi "+cadence+"n)");}
    }
  });
  Object.keys(msgs).forEach(function(pic){
    if(msgs[pic].length>0&&TELEGRAM_CHATS[pic]){
      var text="🔔 *GIP Pipeline Alert* - "+pic+"\\n\\n"+msgs[pic].join("\\n\\n");
      sendTelegram(TELEGRAM_CHATS[pic],text);
    }
  });
}

function sendTelegram(chatId,text){
  var url="https://api.telegram.org/bot"+TELEGRAM_BOT_TOKEN+"/sendMessage";
  UrlFetchApp.fetch(url,{method:"post",contentType:"application/json",payload:JSON.stringify({chat_id:chatId,text:text,parse_mode:"Markdown"})});
}

// ═══ Hướng dẫn setup Telegram Trigger ═══
// 1. Vào Apps Script → Triggers (đồng hồ bên trái)
// 2. Add Trigger → Function: checkAndNotify
// 3. Event source: Time-driven → Day timer → 9:00am
// 4. Save → Authorize
`;

// ── Excel Export ──────────────────────────────────────────
const exportExcel = (deals, reportMonth) => {
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    ["Brand","Contact","Phone","Platform","Stage","PIC","Source","Value","Mã KH","Bảng giá","Ngày nhập data","Gặp lần cuối","Ghi chú gần nhất","Ngày tạo"],
    ...deals.map(d => {
      const notes = parseNotes(d.notes);
      return [d.brand,d.contact,d.phone,Array.isArray(d.platform)?d.platform.join(", "):d.platform,d.stage,d.pic||"",d.source,Number(d.value)||0,d.maKH||"",d.bangGia||"",fmtDate(d.dataInputDate),fmtDate(d.lastMeeting),notes.length?notes[notes.length-1].text:"",fmtDate(d.createdAt)];
    })
  ]);
  ws1["!cols"]=[18,16,14,18,12,10,18,14,12,10,14,14,30,12].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws1,"Tất cả Deals");

  const ws2 = XLSX.utils.aoa_to_sheet([["Brand","PIC","Ngày giờ","Ghi chú"],...deals.flatMap(d=>parseNotes(d.notes).map(n=>[d.brand,d.pic||"",fmtDT(n.date),n.text]))]);
  ws2["!cols"]=[18,10,14,50].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws2,"Nhật ký ghi chú");

  const months=[...new Set(deals.map(d=>monthKey(d.dataInputDate||d.createdAt)).filter(Boolean))].sort();
  const ws3 = XLSX.utils.aoa_to_sheet([["Tháng","Leads mới","Win","Revenue Win","Tỷ lệ Win"],...months.map(m=>{
    const md=deals.filter(d=>monthKey(d.dataInputDate||d.createdAt)===m);
    const won=deals.filter(d=>(Array.isArray(d.stageHistory)?d.stageHistory:[]).some(x=>x.to==="Win"&&monthKey(x.date)===m));
    return [monthLabel(m),md.length,won.length,won.reduce((s,d)=>s+(Number(d.value)||0),0),md.length?Math.round(won.length/md.length*100)+"%":"0%"];
  })]);
  ws3["!cols"]=[16,12,10,20,12].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws3,"Tổng hợp tháng");

  XLSX.writeFile(wb,`GIP_Pipeline_${(reportMonth||"all").replace("-","_")}.xlsx`);
};

// ── App ───────────────────────────────────────────────────
export default function App() {
  const [deals,setDeals]=useState([]);
  const [scriptUrl,setScriptUrl]=useState("");
  const [showSetup,setShowSetup]=useState(false);
  const [modalDeal,setModalDeal]=useState(null);
  const [dragOver,setDragOver]=useState(null);
  const [draggingId,setDraggingId]=useState(null);
  const [syncState,setSyncState]=useState("idle");
  const [search,setSearch]=useState("");
  const [filterPIC,setFilterPIC]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [tab,setTab]=useState("pipeline");
  const [reportMonth,setReportMonth]=useState("");
  const [reportPIC,setReportPIC]=useState("all");

  // Detect owner from URL
  const ownerMode = getOwnerFromURL(); // "" = master, "GIP01" = sub-link
  const isMaster = !ownerMode;

  useEffect(()=>{
    try{const r=localStorage.getItem("gip_deals");if(r)setDeals(JSON.parse(r));}catch{}
    try{const r=localStorage.getItem("gip_script_url");if(r)setScriptUrl(r);}catch{}
    setLoaded(true);
    if(!reportMonth)setReportMonth(monthKey(new Date().toISOString()));
  },[]);
  useEffect(()=>{ if(loaded){try{localStorage.setItem("gip_deals",JSON.stringify(deals));}catch{}} },[deals,loaded]);

  const saveDeal=(deal)=>{
    const now=new Date().toISOString();
    if(deal.id){
      setDeals(p=>p.map(d=>{
        if(d.id!==deal.id)return d;
        let history=Array.isArray(d.stageHistory)?[...d.stageHistory]:[];
        if(d.stage!==deal.stage)history.push({from:d.stage,to:deal.stage,date:now});
        return {...deal,stageHistory:history,updatedAt:now};
      }));
    } else {
      const newDeal={...deal,id:Date.now().toString(),stage:deal.stage||"Data Thô",createdAt:now,updatedAt:now,
        dataInputDate:deal.dataInputDate||now,
        notes:parseNotes(deal.notes),
        stageHistory:[{from:null,to:deal.stage||"Data Thô",date:deal.dataInputDate||now}]};
      if(ownerMode&&!newDeal.pic)newDeal.pic=ownerMode;
      setDeals(p=>[...p,newDeal]);
    }
    setModalDeal(null);
  };

  const deleteDeal=(id)=>{if(confirm("Xoá deal này?"))setDeals(p=>p.filter(d=>d.id!==id));};
  const moveDeal=(id,toStage)=>{
    const now=new Date().toISOString();
    setDeals(p=>p.map(d=>{
      if(d.id!==id||d.stage===toStage)return d;
      const h=Array.isArray(d.stageHistory)?[...d.stageHistory]:[];
      h.push({from:d.stage,to:toStage,date:now});
      return {...d,stage:toStage,stageHistory:h,updatedAt:now};
    }));
  };

  const doSync=async(action)=>{
    if(!scriptUrl){setShowSetup(true);return;}
    setSyncState("syncing");
    try{
      let url=scriptUrl+"?action="+action;
      if(action==="sync")url+="&data="+btoa(unescape(encodeURIComponent(JSON.stringify(deals))));
      const r=await fetch(url);const json=await r.json();
      if(action==="read"&&json.deals){
        setDeals(json.deals.map(d=>({...d,
          platform:d.platform?d.platform.split(", ").filter(Boolean):[],
          notes:parseNotes(d.notes),
          stageHistory:(()=>{try{return JSON.parse(d.stageHistory||"[]");}catch{return [];}})()
        })));
      }
      setSyncState(json.success||json.deals?"success":"error");
    }catch{setSyncState("error");}
    setTimeout(()=>setSyncState("idle"),3000);
  };

  // Filter: sub-link only sees own PIC
  const visibleDeals = ownerMode ? deals.filter(d=>d.pic===ownerMode) : deals;
  const filtered = visibleDeals.filter(d=>{
    const ms=!search||(d.brand||"").toLowerCase().includes(search.toLowerCase())||(d.contact||"").toLowerCase().includes(search.toLowerCase());
    const mp=!filterPIC||d.pic===filterPIC;
    return ms&&mp;
  });

  const overdueCount = visibleDeals.filter(d=>{
    const sla=slaStatus(d);const mtg=meetingStatus(d);
    return (sla&&sla.type==="overdue")||(mtg&&mtg.type==="overdue");
  }).length;

  const stats={
    total:visibleDeals.length,
    hot:visibleDeals.filter(d=>d.stage==="Hot").length,
    win:visibleDeals.filter(d=>d.stage==="Win").length,
    rev:visibleDeals.reduce((s,d)=>s+(Number(d.value)||0),0),
  };
  const allMonths=[...new Set(deals.map(d=>monthKey(d.dataInputDate||d.createdAt)).filter(Boolean))].sort().reverse();

  return(
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#f0f4f8",minHeight:"100vh",color:"#1a2a3a"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@600&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #dde6f0",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"10px",boxShadow:"0 1px 4px rgba(0,80,160,0.07)"}}>
        <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
          <div style={{background:"linear-gradient(135deg,#1a6fba,#2196f3)",borderRadius:"10px",width:"36px",height:"36px",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"800",color:"#fff",fontSize:"11px",boxShadow:"0 2px 8px rgba(26,111,186,0.3)"}}>GIP</div>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:"17px",color:"#1a6fba",lineHeight:1.1}}>
              Sales Pipeline CRM {ownerMode&&<span style={{fontSize:"12px",background:"#e8f3fc",color:"#1a6fba",borderRadius:"6px",padding:"2px 8px",marginLeft:"8px",fontFamily:"'DM Sans',sans-serif"}}>{ownerMode}</span>}
            </div>
            <div style={{fontSize:"9px",color:"#90a8c0",letterSpacing:"0.08em",marginTop:"1px"}}>
              {isMaster?"MASTER VIEW · GIP FULFILLMENT":"OWNER VIEW · GIP FULFILLMENT"}
            </div>
          </div>
        </div>

        {/* Owner quick links (master only) */}
        {isMaster&&(
          <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
            {PICS.map(p=>(
              <a key={p} href={`?owner=${p}`} target="_blank" rel="noreferrer"
                style={{background:"#f0f7ff",border:"1px solid #b3d4f0",borderRadius:"6px",padding:"3px 9px",color:"#1a6fba",fontSize:"11px",fontWeight:"600",textDecoration:"none",cursor:"pointer"}}>
                🔗 {p}
              </a>
            ))}
          </div>
        )}

        <div style={{display:"flex",gap:"7px",alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",background:"#f0f4f8",borderRadius:"8px",padding:"3px",gap:"2px"}}>
            {[["pipeline","📋 Pipeline"],["report","📊 Báo cáo"]].map(([key,label])=>(
              <button key={key} onClick={()=>setTab(key)} style={{background:tab===key?"#fff":"transparent",border:"none",borderRadius:"6px",padding:"5px 13px",color:tab===key?"#1a6fba":"#90a8c0",fontWeight:tab===key?"700":"400",fontSize:"12px",cursor:"pointer",fontFamily:"inherit",boxShadow:tab===key?"0 1px 4px rgba(0,80,160,0.1)":"none"}}>{label}</button>
            ))}
          </div>
          {tab==="pipeline"&&<>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Brand, contact..." style={{background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"7px 11px",color:"#1a2a3a",fontSize:"12px",outline:"none",width:"140px"}}/>
            {isMaster&&(
              <select value={filterPIC} onChange={e=>setFilterPIC(e.target.value)} style={{background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"7px 10px",color:filterPIC?"#1a2a3a":"#90a8c0",fontSize:"12px",outline:"none",fontFamily:"inherit"}}>
                <option value="">Tất cả PIC</option>
                {PICS.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <Btn blue onClick={()=>setModalDeal({pic:ownerMode||""})}>+ Deal mới</Btn>
            <Btn onClick={()=>doSync("read")} disabled={syncState==="syncing"}>↓ Tải</Btn>
            <Btn onClick={()=>doSync("sync")} disabled={syncState==="syncing"} style={{borderColor:syncState==="success"?"#80d0a8":syncState==="error"?"#f0a898":"#c8ddf0",color:syncState==="success"?"#1a7a45":syncState==="error"?"#c0392b":"#1a6fba"}}>
              {syncState==="syncing"?"⟳ Sync...":syncState==="success"?"✓ Synced!":syncState==="error"?"✗ Lỗi":"↑ Sync Sheets"}
            </Btn>
          </>}
          {tab==="report"&&<Btn blue onClick={()=>exportExcel(deals,reportMonth)}>⬇ Xuất Excel</Btn>}
          <Btn onClick={()=>setShowSetup(true)} style={{padding:"7px 10px",color:"#90a8c0"}}>⚙</Btn>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:"flex",background:"#fff",borderBottom:"1px solid #dde6f0"}}>
        {[
          {label:"TỔNG LEADS",val:stats.total,col:"#1a6fba"},
          {label:"HOT LEADS",val:stats.hot,col:"#c0392b"},
          {label:"ĐÃ WIN",val:stats.win,col:"#1a7a45"},
          {label:"TỔNG REV.",val:stats.rev?`${(stats.rev/1e6).toFixed(1)}M ₫`:"—",col:"#b86e00"},
          {label:"⚠️ QUÁ HẠN",val:overdueCount,col:overdueCount>0?"#c0392b":"#90a8c0"},
        ].map((s,i)=>(
          <div key={s.label} style={{flex:1,padding:"10px 18px",borderRight:i<4?"1px solid #dde6f0":"none",background:s.label==="⚠️ QUÁ HẠN"&&overdueCount>0?"#fff5f4":"transparent"}}>
            <div style={{fontSize:"22px",fontWeight:"700",color:s.col,lineHeight:1}}>{s.val}</div>
            <div style={{fontSize:"9px",color:"#90a8c0",letterSpacing:"0.08em",marginTop:"3px"}}>{s.label}</div>
          </div>
        ))}
      </div>

      {tab==="pipeline"
        ?<KanbanBoard deals={filtered} dragOver={dragOver} setDragOver={setDragOver} draggingId={draggingId} setDraggingId={setDraggingId} moveDeal={moveDeal} onEdit={d=>setModalDeal(d)} onDelete={deleteDeal} onAdd={stage=>setModalDeal({stage,pic:ownerMode||""})}/>
        :<ReportView deals={isMaster?deals:visibleDeals} allMonths={allMonths} reportMonth={reportMonth} setReportMonth={setReportMonth} reportPIC={ownerMode||reportPIC} setReportPIC={setReportPIC} isMaster={isMaster}/>
      }
      {modalDeal!==null&&<DealModal deal={modalDeal} onSave={saveDeal} onClose={()=>setModalDeal(null)} ownerMode={ownerMode} isMaster={isMaster}/>}
      {showSetup&&<SetupModal url={scriptUrl} onSave={url=>{setScriptUrl(url);try{localStorage.setItem("gip_script_url",url)}catch{}setShowSetup(false);}} onClose={()=>setShowSetup(false)}/>}
    </div>
  );
}

// ── Kanban ────────────────────────────────────────────────
function KanbanBoard({deals,dragOver,setDragOver,draggingId,setDraggingId,moveDeal,onEdit,onDelete,onAdd}){
  return(
    <div style={{display:"flex",gap:"12px",padding:"18px 20px",overflowX:"auto",minHeight:"calc(100vh - 160px)",alignItems:"flex-start"}}>
      {STAGES.map(stage=>{
        const cfg=STAGE_CFG[stage];
        const sd=deals.filter(d=>d.stage===stage);
        const isOver=dragOver===stage;
        const rev=sd.reduce((s,d)=>s+(Number(d.value)||0),0);
        const overdueInCol=sd.filter(d=>{const sl=slaStatus(d);return sl&&sl.type==="overdue";}).length;
        return(
          <div key={stage}
            onDragOver={e=>{e.preventDefault();setDragOver(stage);}}
            onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragOver(null);}}
            onDrop={e=>{e.preventDefault();if(draggingId)moveDeal(draggingId,stage);setDragOver(null);setDraggingId(null);}}
            style={{flex:"0 0 228px",background:isOver?cfg.head:"#fff",border:`1.5px solid ${isOver?cfg.border:"#dde6f0"}`,borderRadius:"14px",padding:"12px",transition:"all 0.15s",display:"flex",flexDirection:"column",gap:"8px",boxShadow:isOver?`0 4px 16px ${cfg.border}80`:"0 1px 4px rgba(0,80,160,0.07)"}}>
            <div style={{paddingBottom:"10px",borderBottom:`1.5px solid ${cfg.border}`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
                  <span style={{fontSize:"15px"}}>{cfg.icon}</span>
                  <span style={{fontWeight:"700",color:cfg.color,fontSize:"13px"}}>{stage}</span>
                  {overdueInCol>0&&<span style={{background:"#fdecea",color:"#c0392b",borderRadius:"8px",padding:"0px 5px",fontSize:"10px",fontWeight:"700"}}>⚠️{overdueInCol}</span>}
                </div>
                <span style={{background:cfg.badge,color:cfg.color,borderRadius:"10px",padding:"1px 8px",fontSize:"11px",fontWeight:"700",border:`1px solid ${cfg.border}`}}>{sd.length}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:"5px"}}>
                <span style={{fontSize:"10px",color:"#90a8c0"}}>SLA tối đa: {SLA_DAYS[stage]?`${SLA_DAYS[stage]} ngày`:"—"}</span>
                <span style={{fontSize:"12px",color:cfg.color,fontWeight:"700"}}>{sd.some(d=>d.value)?`${(rev/1e6).toFixed(1)}M ₫`:"—"}</span>
              </div>
            </div>
            {sd.map(deal=>(
              <DealCard key={deal.id} deal={deal} cfg={cfg}
                isDragging={draggingId===deal.id}
                onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDraggingId(deal.id);}}
                onDragEnd={()=>setDraggingId(null)}
                onEdit={()=>onEdit(deal)} onDelete={()=>onDelete(deal.id)}/>
            ))}
            {sd.length===0&&<div style={{padding:"20px 0",textAlign:"center",color:isOver?cfg.color:"#c0cfd8",fontSize:"11px"}}>{isOver?"↓ Thả vào đây":"Chưa có deal"}</div>}
            <button onClick={()=>onAdd(stage)} style={{background:"transparent",border:`1px dashed ${cfg.border}`,borderRadius:"8px",padding:"7px",color:"#90a8c0",fontSize:"12px",cursor:"pointer",width:"100%",fontFamily:"inherit",transition:"all 0.15s"}}
              onMouseEnter={e=>{e.target.style.color=cfg.color;e.target.style.background=cfg.badge;}}
              onMouseLeave={e=>{e.target.style.color="#90a8c0";e.target.style.background="transparent";}}>
              + Thêm deal
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Deal Card ─────────────────────────────────────────────
function DealCard({deal,cfg,isDragging,onDragStart,onDragEnd,onEdit,onDelete}){
  const [hover,setHover]=useState(false);
  const [showNotes,setShowNotes]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const platforms=Array.isArray(deal.platform)?deal.platform:(deal.platform?[deal.platform]:[]);
  const history=(Array.isArray(deal.stageHistory)?deal.stageHistory:[]).filter(h=>h.from);
  const notes=parseNotes(deal.notes);
  const sla=slaStatus(deal);
  const mtg=meetingStatus(deal);
  const slaColor=sla?.type==="overdue"?"#c0392b":sla?.type==="warning"?"#b86e00":"#6b7c93";
  const mtgColor=mtg?.type==="overdue"?"#c0392b":"#b86e00";
  return(
    <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{background:hover?cfg.head:"#fafcff",border:`1px solid ${sla?.type==="overdue"?"#f0a898":hover?cfg.border:"#dde6f0"}`,borderRadius:"10px",padding:"11px",cursor:"grab",opacity:isDragging?0.4:1,transition:"all 0.12s",boxShadow:hover?`0 2px 10px ${cfg.border}80`:"0 1px 3px rgba(0,80,160,0.06)"}}>
      
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"6px"}}>
        <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",lineHeight:1.3,flex:1}}>{deal.brand||"—"}</div>
        {hover&&<div style={{display:"flex",gap:"3px",flexShrink:0}}>
          <MiniBtn onClick={onEdit} title="Sửa">✎</MiniBtn>
          <MiniBtn onClick={onDelete} title="Xoá" danger>✕</MiniBtn>
        </div>}
      </div>

      {/* SLA + Meeting alerts */}
      {sla&&<div style={{marginTop:"5px",background:sla.type==="overdue"?"#fdecea":"#fff8e6",borderRadius:"5px",padding:"3px 7px",fontSize:"10px",color:slaColor,fontWeight:"600"}}>⏰ {sla.label}</div>}
      {mtg&&<div style={{marginTop:"4px",background:"#fdecea",borderRadius:"5px",padding:"3px 7px",fontSize:"10px",color:mtgColor,fontWeight:"600"}}>📅 {mtg.label}</div>}

      {deal.pic&&<div style={{fontSize:"10px",color:"#fff",background:cfg.color,borderRadius:"4px",padding:"1px 7px",display:"inline-block",marginTop:"5px",fontWeight:"600"}}>{deal.pic}</div>}
      {deal.contact&&<div style={{fontSize:"11px",color:"#6080a0",marginTop:"4px"}}>👤 {deal.contact}</div>}
      {deal.phone&&<div style={{fontSize:"11px",color:"#6080a0",marginTop:"2px"}}>📞 {deal.phone}</div>}
      {deal.maKH&&<div style={{fontSize:"11px",color:"#1a7a45",marginTop:"2px",fontWeight:"600"}}>🆔 {deal.maKH}</div>}
      {deal.bangGia&&<div style={{fontSize:"11px",color:"#1a7a45",marginTop:"1px"}}>💼 {deal.bangGia}</div>}

      {platforms.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:"4px",marginTop:"7px"}}>
        {platforms.map(p=><span key={p} style={{background:cfg.badge,border:`1px solid ${cfg.border}`,borderRadius:"4px",padding:"1px 6px",fontSize:"10px",color:cfg.color,fontWeight:"500"}}>{p}</span>)}
      </div>}

      <div style={{display:"flex",justifyContent:"space-between",marginTop:"8px",alignItems:"center"}}>
        {deal.value?<span style={{fontSize:"11px",color:"#b86e00",fontWeight:"700"}}>{Number(deal.value)>=1e6?`${(Number(deal.value)/1e6).toFixed(0)}M`:Number(deal.value).toLocaleString()}₫</span>:<span/>}
        {deal.source&&<span style={{fontSize:"10px",color:"#90a8c0",maxWidth:"90px",textAlign:"right",lineHeight:1.2}}>{deal.source}</span>}
      </div>

      {notes.length>0&&<div style={{marginTop:"7px",background:"#f8f9fb",borderRadius:"6px",padding:"5px 8px",fontSize:"10px",color:"#6080a0",borderLeft:`2px solid ${cfg.border}`}}>
        💬 {notes[notes.length-1].text.length>50?notes[notes.length-1].text.slice(0,50)+"...":notes[notes.length-1].text}
      </div>}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"8px",paddingTop:"7px",borderTop:"1px solid #eef3f8"}}>
        <span style={{fontSize:"10px",color:"#a0b8d0"}}>📅 {fmtDate(deal.dataInputDate||deal.createdAt)||"—"}</span>
        <div style={{display:"flex",gap:"6px"}}>
          {notes.length>0&&<button onClick={e=>{e.stopPropagation();setShowNotes(v=>!v);}} style={{background:"transparent",border:"none",fontSize:"10px",color:"#b86e00",cursor:"pointer",fontFamily:"inherit",padding:0}}>💬 {notes.length}</button>}
          {history.length>0&&<button onClick={e=>{e.stopPropagation();setShowHistory(v=>!v);}} style={{background:"transparent",border:"none",fontSize:"10px",color:"#1a6fba",cursor:"pointer",fontFamily:"inherit",padding:0}}>🕐 {history.length}</button>}
        </div>
      </div>

      {showNotes&&notes.length>0&&(
        <div style={{marginTop:"8px",background:"#fffbf0",border:"1px solid #f0cc80",borderRadius:"8px",padding:"8px",maxHeight:"160px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"5px"}}>
          {[...notes].reverse().map((n,i)=>(
            <div key={i} style={{fontSize:"11px"}}>
              <div style={{color:"#90a8c0",fontSize:"9px",marginBottom:"2px"}}>🕐 {fmtDT(n.date)}</div>
              <div style={{color:"#1a2a3a",lineHeight:1.4}}>{n.text}</div>
              {i<notes.length-1&&<div style={{borderBottom:"1px solid #f0e0b0",marginTop:"5px"}}/>}
            </div>
          ))}
        </div>
      )}
      {showHistory&&history.length>0&&(
        <div style={{marginTop:"8px",background:"#f4f8fc",borderRadius:"7px",padding:"8px",display:"flex",flexDirection:"column",gap:"4px"}}>
          {history.map((h,i)=>{
            const prev=history[i-1]?.date||deal.dataInputDate||deal.createdAt;
            const fc=STAGE_CFG[h.from]||{};const tc=STAGE_CFG[h.to]||{};
            return(<div key={i} style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px"}}>
              <span style={{color:fc.color,fontWeight:"600"}}>{fc.icon} {h.from}</span><span style={{color:"#c0cfd8"}}>→</span>
              <span style={{color:tc.color,fontWeight:"600"}}>{tc.icon} {h.to}</span>
              <span style={{color:"#a0b8d0",marginLeft:"auto"}}>{daysBetween(prev,h.date)>0?`${daysBetween(prev,h.date)}d · `:""}{fmtDate(h.date)}</span>
            </div>);
          })}
        </div>
      )}
    </div>
  );
}

// ── Report ────────────────────────────────────────────────
function ReportView({deals,allMonths,reportMonth,setReportMonth,reportPIC,setReportPIC,isMaster}){
  const currentMonth=monthKey(new Date().toISOString());
  const months=[...new Set([currentMonth,...allMonths])].sort().reverse();
  const picDeals=reportPIC==="all"?deals:deals.filter(d=>d.pic===reportPIC);
  const monthDeals=picDeals.filter(d=>monthKey(d.dataInputDate||d.createdAt)===reportMonth);
  const movedThisMonth=picDeals.flatMap(d=>(Array.isArray(d.stageHistory)?d.stageHistory:[]).filter(h=>h.from&&monthKey(h.date)===reportMonth).map(h=>({...h,brand:d.brand,pic:d.pic})));
  const wonThisMonth=picDeals.filter(d=>(Array.isArray(d.stageHistory)?d.stageHistory:[]).some(x=>x.to==="Win"&&monthKey(x.date)===reportMonth));
  const overdueDeals=picDeals.filter(d=>{const sl=slaStatus(d);return sl&&sl.type==="overdue";});
  const avgDays={};
  STAGES.forEach((st,i)=>{
    if(i===0)return;const from=STAGES[i-1];
    const ts=picDeals.flatMap(d=>{const h=(Array.isArray(d.stageHistory)?d.stageHistory:[]);return h.filter(x=>x.from===from&&x.to===st).map(x=>{const prev=h.slice(0,h.indexOf(x)).reverse().find(y=>y.to===from)?.date||(d.dataInputDate||d.createdAt);return daysBetween(prev,x.date);});});
    avgDays[`${from}→${st}`]=ts.length?Math.round(ts.reduce((a,b)=>a+b,0)/ts.length):null;
  });
  const picStats=PICS.map(pic=>{
    const pd=deals.filter(d=>d.pic===pic);
    const won=pd.filter(d=>(Array.isArray(d.stageHistory)?d.stageHistory:[]).some(x=>x.to==="Win"&&monthKey(x.date)===reportMonth));
    return {pic,total:pd.length,hot:pd.filter(d=>d.stage==="Hot").length,win:won.length,rev:won.reduce((s,d)=>s+(Number(d.value)||0),0),overdue:pd.filter(d=>{const sl=slaStatus(d);return sl&&sl.type==="overdue";}).length};
  }).filter(p=>p.total>0);

  return(
    <div style={{padding:"20px",maxWidth:"960px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"20px",flexWrap:"wrap"}}>
        <span style={{fontFamily:"'Playfair Display',serif",fontSize:"17px",color:"#1a6fba"}}>📊 Báo cáo</span>
        <select value={reportMonth} onChange={e=>setReportMonth(e.target.value)} style={{background:"#fff",border:"1.5px solid #c8ddf0",borderRadius:"8px",padding:"7px 14px",color:"#1a2a3a",fontSize:"13px",outline:"none",fontFamily:"inherit",fontWeight:"600"}}>
          {months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        {isMaster&&<div style={{display:"flex",background:"#f0f4f8",borderRadius:"8px",padding:"3px",gap:"2px",flexWrap:"wrap"}}>
          <button onClick={()=>setReportPIC("all")} style={{background:reportPIC==="all"?"#fff":"transparent",border:"none",borderRadius:"6px",padding:"5px 12px",color:reportPIC==="all"?"#1a6fba":"#90a8c0",fontWeight:reportPIC==="all"?"700":"400",fontSize:"12px",cursor:"pointer",fontFamily:"inherit"}}>Tất cả</button>
          {PICS.map(p=><button key={p} onClick={()=>setReportPIC(p)} style={{background:reportPIC===p?"#fff":"transparent",border:"none",borderRadius:"6px",padding:"5px 12px",color:reportPIC===p?"#1a6fba":"#90a8c0",fontWeight:reportPIC===p?"700":"400",fontSize:"12px",cursor:"pointer",fontFamily:"inherit"}}>{p}</button>)}
        </div>}
      </div>

      {/* Summary */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"20px"}}>
        {[{label:"Leads mới",val:monthDeals.length,col:"#1a6fba",icon:"➕"},{label:"Chuyển stage",val:movedThisMonth.length,col:"#b86e00",icon:"🔄"},{label:"Deal Win",val:wonThisMonth.length,col:"#1a7a45",icon:"🏆"},{label:"Rev. Win",val:wonThisMonth.reduce((s,d)=>s+(Number(d.value)||0),0)?`${(wonThisMonth.reduce((s,d)=>s+(Number(d.value)||0),0)/1e6).toFixed(0)}M₫`:"—",col:"#0e5fa3",icon:"💰"},{label:"⚠️ Quá hạn",val:overdueDeals.length,col:overdueDeals.length>0?"#c0392b":"#90a8c0",icon:"🚨"}].map(c=>(
          <div key={c.label} style={{background:"#fff",border:`1px solid ${c.label==="⚠️ Quá hạn"&&overdueDeals.length>0?"#f0a898":"#dde6f0"}`,borderRadius:"12px",padding:"14px 16px",boxShadow:"0 1px 4px rgba(0,80,160,0.07)"}}>
            <div style={{fontSize:"18px",marginBottom:"4px"}}>{c.icon}</div>
            <div style={{fontSize:"22px",fontWeight:"700",color:c.col,lineHeight:1}}>{c.val}</div>
            <div style={{fontSize:"10px",color:"#90a8c0",marginTop:"4px"}}>{c.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px"}}>
        {/* PIC performance */}
        {reportPIC==="all"&&isMaster&&picStats.length>0&&(
          <div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"16px",gridColumn:"1/-1"}}>
            <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",marginBottom:"14px"}}>👤 Hiệu suất PIC — {monthLabel(reportMonth)}</div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
                <thead><tr style={{borderBottom:"2px solid #dde6f0"}}>
                  {["PIC","Tổng leads","Hot","Win tháng này","Revenue","⚠️ Quá hạn"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",color:"#6080a0",fontWeight:"600",whiteSpace:"nowrap"}}>{h}</th>)}
                </tr></thead>
                <tbody>{picStats.map((p,i)=>(
                  <tr key={p.pic} style={{borderBottom:"1px solid #f0f4f8",background:i%2===0?"#fafcff":"#fff"}}>
                    <td style={{padding:"8px 12px",fontWeight:"700",color:"#1a6fba"}}>{p.pic}</td>
                    <td style={{padding:"8px 12px"}}>{p.total}</td>
                    <td style={{padding:"8px 12px",color:"#c0392b",fontWeight:"600"}}>{p.hot}</td>
                    <td style={{padding:"8px 12px",color:"#1a7a45",fontWeight:"600"}}>{p.win}</td>
                    <td style={{padding:"8px 12px",color:"#b86e00",fontWeight:"600"}}>{p.rev>0?`${(p.rev/1e6).toFixed(0)}M₫`:"—"}</td>
                    <td style={{padding:"8px 12px",color:p.overdue>0?"#c0392b":"#90a8c0",fontWeight:p.overdue>0?"700":"400"}}>{p.overdue>0?`⚠️ ${p.overdue}`:"✓ OK"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stage bar */}
        <div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"16px"}}>
          <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",marginBottom:"14px"}}>📋 Phân bổ stage</div>
          {STAGES.map(st=>{const cfg=STAGE_CFG[st];const cnt=monthDeals.filter(d=>d.stage===st).length;const max=Math.max(...STAGES.map(s=>monthDeals.filter(d=>d.stage===s).length),1);return(
            <div key={st} style={{marginBottom:"10px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                <span style={{fontSize:"12px",color:cfg.color,fontWeight:"600"}}>{cfg.icon} {st}</span>
                <span style={{fontSize:"12px",color:"#6080a0",fontWeight:"600"}}>{cnt}</span>
              </div>
              <div style={{background:"#f0f4f8",borderRadius:"4px",height:"6px"}}><div style={{background:cfg.border,width:`${max>0?(cnt/max)*100:0}%`,height:"100%",borderRadius:"4px",transition:"width 0.5s"}}/></div>
            </div>);
          })}
        </div>

        {/* Avg days */}
        <div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"16px"}}>
          <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",marginBottom:"14px"}}>⏱ Avg ngày / SLA</div>
          {Object.entries(avgDays).map(([key,val])=>{
            const [from,to]=key.split("→");const fc=STAGE_CFG[from]||{};const tc=STAGE_CFG[to]||{};const sla=SLA_DAYS[from];
            const overSLA=val!==null&&sla&&val>sla;
            return(<div key={key} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px",background:overSLA?"#fdecea":"#f4f8fc",borderRadius:"8px",padding:"8px 10px"}}>
              <span style={{fontSize:"11px",color:fc.color,fontWeight:"600"}}>{fc.icon} {from}</span>
              <span style={{color:"#c0cfd8",fontSize:"12px"}}>→</span>
              <span style={{fontSize:"11px",color:tc.color,fontWeight:"600"}}>{tc.icon} {to}</span>
              <span style={{marginLeft:"auto",fontSize:"12px",fontWeight:"700",color:overSLA?"#c0392b":val!==null?"#1a6fba":"#c0cfd8"}}>{val!==null?`${val}n (SLA:${sla}n)`:"—"}</span>
            </div>);
          })}
        </div>

        {/* Overdue list */}
        {overdueDeals.length>0&&(
          <div style={{background:"#fff",border:"1.5px solid #f0a898",borderRadius:"12px",padding:"16px",gridColumn:"1/-1"}}>
            <div style={{fontWeight:"700",color:"#c0392b",fontSize:"13px",marginBottom:"14px"}}>🚨 Danh sách KH quá hạn SLA</div>
            <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {overdueDeals.map(d=>{const sl=slaStatus(d);const cfg=STAGE_CFG[d.stage]||{};return(
                <div key={d.id} style={{display:"flex",alignItems:"center",gap:"12px",background:"#fff5f4",borderRadius:"8px",padding:"8px 12px"}}>
                  <span style={{fontWeight:"700",color:"#1a2a3a",minWidth:"120px"}}>{d.brand}</span>
                  {d.pic&&<span style={{fontSize:"10px",background:"#e8f3fc",color:"#1a6fba",borderRadius:"4px",padding:"1px 7px",fontWeight:"600"}}>{d.pic}</span>}
                  <span style={{fontSize:"11px",color:cfg.color,fontWeight:"600"}}>{cfg.icon} {d.stage}</span>
                  <span style={{marginLeft:"auto",fontSize:"11px",color:"#c0392b",fontWeight:"700"}}>⚠️ {sl?.label}</span>
                </div>);
              })}
            </div>
          </div>
        )}

        {/* Transition log */}
        <div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"16px",gridColumn:"1/-1"}}>
          <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",marginBottom:"14px"}}>🔄 Lịch sử chuyển stage tháng này</div>
          {movedThisMonth.length===0?<div style={{color:"#c0cfd8",fontSize:"12px",textAlign:"center",padding:"20px 0"}}>Chưa có</div>:
          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
            {movedThisMonth.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((h,i)=>{
              const fc=STAGE_CFG[h.from]||{};const tc=STAGE_CFG[h.to]||{};
              return(<div key={i} style={{display:"flex",alignItems:"center",gap:"10px",background:"#f4f8fc",borderRadius:"8px",padding:"8px 12px"}}>
                <span style={{fontSize:"12px",fontWeight:"700",color:"#1a2a3a",minWidth:"110px"}}>{h.brand}</span>
                {h.pic&&<span style={{fontSize:"10px",background:"#e8f3fc",color:"#1a6fba",borderRadius:"4px",padding:"1px 6px",fontWeight:"600"}}>{h.pic}</span>}
                <span style={{fontSize:"11px",color:fc.color,fontWeight:"600"}}>{fc.icon} {h.from}</span>
                <span style={{color:"#c0cfd8"}}>→</span>
                <span style={{fontSize:"11px",color:tc.color,fontWeight:"600"}}>{tc.icon} {h.to}</span>
                <span style={{marginLeft:"auto",fontSize:"11px",color:"#90a8c0"}}>{fmtDate(h.date)}</span>
              </div>);
            })}
          </div>}
        </div>
      </div>
    </div>
  );
}

// ── Shared UI ─────────────────────────────────────────────
function Btn({children,onClick,blue,disabled,style={}}){return(<button onClick={onClick} disabled={disabled} style={{background:blue?"linear-gradient(135deg,#1a6fba,#2196f3)":"#fff",border:blue?"none":"1px solid #c8ddf0",borderRadius:"8px",padding:"7px 13px",color:blue?"#fff":"#1a6fba",fontWeight:blue?"700":"500",fontSize:"12px",cursor:disabled?"default":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit",boxShadow:blue?"0 2px 6px rgba(26,111,186,0.25)":"none",...style}}>{children}</button>);}
function Field({label,children,span}){return(<div style={span?{gridColumn:"1/-1"}:{}}><div style={{fontSize:"10px",color:"#90a8c0",fontWeight:"600",letterSpacing:"0.06em",marginBottom:"5px"}}>{label.toUpperCase()}</div>{children}</div>);}
function Inp({value,onChange,placeholder,type="text",multiline}){const base={background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"8px 10px",color:"#1a2a3a",fontSize:"13px",width:"100%",outline:"none",boxSizing:"border-box",fontFamily:"inherit"};return multiline?<textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={2} style={{...base,resize:"vertical"}}/>:<input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={base}/>;}
function Modal({children,onClose}){return(<div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,40,80,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:"12px",backdropFilter:"blur(4px)"}}><div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"16px",padding:"24px",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 8px 40px rgba(0,80,160,0.15)"}}>{children}</div></div>);}
function MiniBtn({onClick,children,danger,title}){return(<button onClick={e=>{e.stopPropagation();onClick();}} title={title} style={{background:"transparent",border:"none",borderRadius:"4px",width:"20px",height:"20px",color:danger?"#c0392b":"#90a8c0",cursor:"pointer",fontSize:"12px",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>{children}</button>);}

// ── Deal Modal ────────────────────────────────────────────
function DealModal({deal,onSave,onClose,ownerMode,isMaster}){
  const isNew=!deal.id;
  const initDate=deal.dataInputDate?toDisplayDate(deal.dataInputDate):(isNew?toDisplayDate(new Date().toISOString()):"");
  const initMeeting=deal.lastMeeting?toDisplayDate(deal.lastMeeting):"";
  const [f,setF]=useState({brand:"",contact:"",phone:"",platform:[],stage:"Data Thô",pic:ownerMode||"",source:"",value:"",notes:[],maKH:"",bangGia:"",...deal,notes:parseNotes(deal.notes)});
  const [dateInput,setDateInput]=useState(initDate);
  const [meetingInput,setMeetingInput]=useState(initMeeting);
  const [newNote,setNewNote]=useState("");
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const togglePlatform=p=>s("platform",f.platform.includes(p)?f.platform.filter(x=>x!==p):[...f.platform,p]);
  const addNote=()=>{ if(!newNote.trim())return; s("notes",[...f.notes,{text:newNote.trim(),date:new Date().toISOString()}]); setNewNote(""); };
  const isWin=f.stage==="Win";

  const handleSave=()=>{
    if(!f.brand.trim())return alert("Vui lòng nhập tên Brand!");
    const isoDate=toISODate(dateInput)||new Date().toISOString();
    const isoMeeting=toISODate(meetingInput)||"";
    onSave({...f,dataInputDate:isoDate,lastMeeting:isoMeeting});
  };

  return(
    <Modal onClose={onClose}>
      <div style={{width:"520px",maxWidth:"93vw"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:"18px",color:"#1a6fba",marginBottom:"18px"}}>{isNew?"✦ Thêm Deal Mới":"✦ Chỉnh sửa Deal"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"13px"}}>

          <Field label="Tên Brand *" span><Inp value={f.brand} onChange={v=>s("brand",v)} placeholder="Ví dụ: Cafuné, Owen..."/></Field>
          <Field label="Người liên hệ"><Inp value={f.contact} onChange={v=>s("contact",v)} placeholder="Tên người phụ trách"/></Field>
          <Field label="Số điện thoại"><Inp value={f.phone} onChange={v=>s("phone",v)} placeholder="0901..."/></Field>

          {/* Date input + Last meeting */}
          <Field label="Ngày nhập data">
            <Inp value={dateInput} onChange={setDateInput} placeholder="DD/MM/YYYY"/>
          </Field>
          {(f.stage==="Warm"||f.stage==="Hot"||f.stage==="Win")&&(
            <Field label={`Gặp KH lần cuối ${MEETING_CADENCE[f.stage]?`(cần gặp mỗi ${MEETING_CADENCE[f.stage]}n)`:""}`}>
              <Inp value={meetingInput} onChange={setMeetingInput} placeholder="DD/MM/YYYY"/>
            </Field>
          )}

          {/* PIC */}
          <Field label="BD P.I.C" span>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {PICS.map(p=>{const active=f.pic===p;return(<button key={p} onClick={()=>(!ownerMode||isMaster)&&s("pic",active?"":p)} style={{background:active?"#e8f3fc":"#f4f8fc",border:`1.5px solid ${active?"#90c0ef":"#dde6f0"}`,borderRadius:"8px",padding:"5px 12px",color:active?"#1a6fba":"#90a8c0",fontSize:"12px",fontWeight:active?"700":"400",cursor:(!ownerMode||isMaster)?"pointer":"default",fontFamily:"inherit",opacity:ownerMode&&!isMaster&&!active?0.4:1}}>{p}</button>);})}
            </div>
          </Field>

          {/* Stage */}
          <Field label="Giai đoạn Pipeline" span>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {STAGES.map(st=>{const cfg=STAGE_CFG[st];const active=f.stage===st;const sla=SLA_DAYS[st];return(<button key={st} onClick={()=>s("stage",st)} style={{background:active?cfg.badge:"#f4f8fc",border:`1.5px solid ${active?cfg.border:"#dde6f0"}`,borderRadius:"8px",padding:"5px 12px",color:active?cfg.color:"#90a8c0",fontSize:"12px",fontWeight:active?"700":"400",cursor:"pointer",fontFamily:"inherit"}}>
                {cfg.icon} {st}{sla?<span style={{fontSize:"9px",color:active?cfg.color:"#b0c0d0",marginLeft:"3px"}}>({sla}n)</span>:null}
              </button>);})}
            </div>
          </Field>

          {/* Platform */}
          <Field label="Platform" span>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {PLATFORMS.map(p=>{const active=f.platform.includes(p);return(<button key={p} onClick={()=>togglePlatform(p)} style={{background:active?"#e8f3fc":"#f4f8fc",border:`1.5px solid ${active?"#90c0ef":"#dde6f0"}`,borderRadius:"8px",padding:"5px 12px",color:active?"#1a6fba":"#90a8c0",fontSize:"12px",fontWeight:active?"600":"400",cursor:"pointer",fontFamily:"inherit"}}>{p}</button>);})}
            </div>
          </Field>

          {/* Source */}
          <Field label="Nguồn lead">
            <select value={f.source} onChange={e=>s("source",e.target.value)} style={{background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"8px 10px",color:f.source?"#1a2a3a":"#90a8c0",fontSize:"13px",width:"100%",outline:"none",fontFamily:"inherit"}}>
              <option value="">Chọn nguồn...</option>
              {Object.entries(SOURCE_GROUPS).map(([group,items])=>(
                <optgroup key={group} label={`── ${group}`}>{items.map(src=><option key={`${group}-${src}`} value={`${group}: ${src}`}>{src}</option>)}</optgroup>
              ))}
            </select>
          </Field>

          <Field label="Giá trị dự kiến (VND)"><Inp value={f.value} onChange={v=>s("value",v)} placeholder="50000000" type="number"/></Field>

          {/* Win-specific fields */}
          {isWin&&<>
            <Field label="🆔 Mã Khách Hàng"><Inp value={f.maKH||""} onChange={v=>s("maKH",v)} placeholder="GIP-KH-001"/></Field>
            <Field label="💼 Bảng Giá">
              <select value={f.bangGia||""} onChange={e=>s("bangGia",e.target.value)} style={{background:"#e6f8ee",border:"1px solid #80d0a8",borderRadius:"8px",padding:"8px 10px",color:f.bangGia?"#1a7a45":"#90a8c0",fontSize:"13px",width:"100%",outline:"none",fontFamily:"inherit"}}>
                <option value="">Chọn bảng giá...</option>
                {BANG_GIA.map(b=><option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
          </>}

          {/* Notes */}
          <Field label="Ghi chú" span>
            <div style={{display:"flex",gap:"6px",marginBottom:"8px"}}>
              <input value={newNote} onChange={e=>setNewNote(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addNote();}}} placeholder="Nhập ghi chú → Enter để lưu..." style={{background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"8px 10px",color:"#1a2a3a",fontSize:"13px",flex:1,outline:"none",fontFamily:"inherit"}}/>
              <button onClick={addNote} style={{background:"linear-gradient(135deg,#1a6fba,#2196f3)",border:"none",borderRadius:"8px",padding:"8px 14px",color:"#fff",fontWeight:"700",fontSize:"13px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>➕ Thêm</button>
            </div>
            {f.notes.length>0?(
              <div style={{background:"#f4f8fc",borderRadius:"10px",padding:"10px",maxHeight:"200px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"6px"}}>
                {[...f.notes].reverse().map((n,i)=>(
                  <div key={i} style={{background:"#fff",borderRadius:"8px",padding:"8px 10px",border:"1px solid #dde6f0",position:"relative"}}>
                    <div style={{fontSize:"9px",color:"#90a8c0",marginBottom:"3px"}}>🕐 {fmtDT(n.date)}</div>
                    <div style={{fontSize:"12px",color:"#1a2a3a",lineHeight:1.5,paddingRight:"20px"}}>{n.text}</div>
                    <button onClick={()=>s("notes",f.notes.filter((_,idx)=>f.notes.length-1-i!==idx))} style={{position:"absolute",top:"6px",right:"6px",background:"transparent",border:"none",color:"#f0a898",cursor:"pointer",fontSize:"11px"}}>✕</button>
                  </div>
                ))}
              </div>
            ):<div style={{fontSize:"11px",color:"#c0cfd8",textAlign:"center",padding:"12px 0"}}>Chưa có ghi chú</div>}
          </Field>
        </div>

        {!isNew&&f.createdAt&&<div style={{fontSize:"11px",color:"#a0b8d0",marginTop:"12px"}}>📅 Tạo: {fmtDate(f.createdAt)} · Cập nhật: {fmtDate(f.updatedAt)}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",gap:"8px",marginTop:"16px"}}>
          <Btn onClick={onClose}>Huỷ</Btn>
          <Btn blue onClick={handleSave}>{isNew?"Tạo Deal":"Lưu thay đổi"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Setup Modal ───────────────────────────────────────────
function SetupModal({url,onSave,onClose}){
  const [inputUrl,setInputUrl]=useState(url||"");
  const [copied,setCopied]=useState(false);
  const copy=()=>{navigator.clipboard.writeText(SCRIPT_CODE);setCopied(true);setTimeout(()=>setCopied(false),2000);};
  const ownerLinks=PICS.map(p=>({pic:p,url:`${window.location.origin}${window.location.pathname}?owner=${p}`}));
  return(
    <Modal onClose={onClose}>
      <div style={{width:"560px",maxWidth:"93vw"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:"18px",color:"#1a6fba",marginBottom:"14px"}}>⚙ Cài đặt & Kết nối</div>

        {/* Owner links */}
        <div style={{background:"#f0f7ff",border:"1px solid #c8ddf0",borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"11px",color:"#1a6fba",fontWeight:"600",marginBottom:"10px"}}>🔗 Link cho từng Owner (chia sẻ cho Sales):</div>
          {ownerLinks.map(({pic,url})=>(
            <div key={pic} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
              <span style={{fontSize:"11px",fontWeight:"700",color:"#1a6fba",minWidth:"70px"}}>{pic}:</span>
              <span style={{fontSize:"10px",color:"#6080a0",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{url}</span>
              <button onClick={()=>navigator.clipboard.writeText(url)} style={{background:"#e8f3fc",border:"1px solid #b3d4f0",borderRadius:"5px",padding:"2px 8px",color:"#1a6fba",fontSize:"10px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Copy</button>
            </div>
          ))}
        </div>

        {/* Telegram info */}
        <div style={{background:"#f0fdf6",border:"1px solid #80d0a8",borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"11px",color:"#1a7a45",fontWeight:"600",marginBottom:"8px"}}>🤖 Telegram Notification Setup:</div>
          <div style={{fontSize:"11px",color:"#2a6a4a",lineHeight:1.6}}>
            1. Tạo bot: nhắn <b>/newbot</b> cho <b>@BotFather</b> → lấy Token<br/>
            2. Mỗi owner nhắn <b>/start</b> cho bot → lấy Chat ID (dùng @userinfobot)<br/>
            3. Điền Token + Chat IDs vào Apps Script code<br/>
            4. Setup Trigger: hàng ngày 9:00am → chạy <b>checkAndNotify()</b>
          </div>
        </div>

        {/* Apps Script */}
        <div style={{marginBottom:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
            <span style={{fontSize:"10px",color:"#90a8c0",fontWeight:"600",letterSpacing:"0.06em"}}>APPS SCRIPT CODE (bao gồm Telegram)</span>
            <button onClick={copy} style={{background:copied?"#e6f8ee":"#f4f8fc",border:`1px solid ${copied?"#80d0a8":"#c8ddf0"}`,borderRadius:"6px",padding:"3px 10px",color:copied?"#1a7a45":"#1a6fba",fontSize:"11px",cursor:"pointer",fontFamily:"inherit"}}>{copied?"✓ Đã copy!":"📋 Copy code"}</button>
          </div>
          <pre style={{background:"#f4f8fc",border:"1px solid #dde6f0",borderRadius:"8px",padding:"12px",fontSize:"10px",color:"#6080a0",overflowX:"auto",maxHeight:"120px",overflowY:"auto",margin:0,lineHeight:1.6}}>{SCRIPT_CODE}</pre>
        </div>

        <Field label="Web App URL (Google Apps Script)">
          <Inp value={inputUrl} onChange={setInputUrl} placeholder="https://script.google.com/macros/s/.../exec"/>
        </Field>
        <div style={{display:"flex",justifyContent:"flex-end",gap:"8px",marginTop:"16px"}}>
          <Btn onClick={onClose}>Đóng</Btn>
          <Btn blue onClick={()=>onSave(inputUrl.trim())}>Lưu kết nối</Btn>
        </div>
      </div>
    </Modal>
  );
}
