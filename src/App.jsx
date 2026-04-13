import { useState, useEffect } from "react";
import * as XLSX from "xlsx";

const STAGES = ["Freeze", "Cold", "Warm", "Hot", "Win"];
const PLATFORMS = ["Shopee", "Lazada", "TikTok Shop", "Website", "Khác"];
const SOURCE_GROUPS = {
  "Cá nhân": ["Facebook", "Zalo", "Group", "Khách giới thiệu", "Khác"],
  "Sếp Loki": ["Facebook", "Zalo", "Group", "Khách giới thiệu", "Khác"],
};

const STAGE_CFG = {
  Freeze: { icon: "❄️", color: "#1a6fba", border: "#b3d4f0", badge: "#e8f3fc", head: "#f0f7ff" },
  Cold:   { icon: "🌊", color: "#0e5fa3", border: "#90c0ef", badge: "#ddeefa", head: "#eaf5ff" },
  Warm:   { icon: "☀️", color: "#b86e00", border: "#f0cc80", badge: "#fff8e6", head: "#fffbf0" },
  Hot:    { icon: "🔥", color: "#c0392b", border: "#f0a898", badge: "#fdecea", head: "#fff5f4" },
  Win:    { icon: "🏆", color: "#1a7a45", border: "#80d0a8", badge: "#e6f8ee", head: "#f0fdf6" },
};

const SCRIPT_CODE = `function doGet(e){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sh=ss.getSheetByName("Pipeline")||ss.getActiveSheet();
  var act=e.parameter.action;
  if(act==="sync"){
    var deals=JSON.parse(decodeURIComponent(escape(atob(e.parameter.data))));
    sh.clearContents();
    sh.appendRow(["ID","Brand","Contact","Phone","Platform","Stage","Source","Value","Notes","Created","Updated","StageHistory"]);
    deals.forEach(function(d){
      sh.appendRow([d.id,d.brand||"",d.contact||"",d.phone||"",
        Array.isArray(d.platform)?d.platform.join(", "):d.platform||"",
        d.stage||"",d.source||"",d.value||"",d.notes||"",d.createdAt||"",d.updatedAt||"",
        JSON.stringify(d.stageHistory||[])]);
    });
    return out({success:true,count:deals.length});
  }
  if(act==="read"){
    var data=sh.getDataRange().getValues();
    if(data.length<=1)return out({deals:[]});
    var keys=["id","brand","contact","phone","platform","stage","source","value","notes","createdAt","updatedAt","stageHistory"];
    var rows=data.slice(1).map(function(r){var o={};keys.forEach(function(k,i){o[k]=String(r[i]||"")});return o});
    return out({deals:rows});
  }
  return out({error:"Unknown action"});
}
function out(d){return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);}`;

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
};
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const monthKey = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const monthLabel = (key) => { if (!key) return ""; const [y,m] = key.split("-"); return `Tháng ${parseInt(m)}/${y}`; };

// ── Excel Export ──────────────────────────────────────────
const exportExcel = (deals, reportMonth) => {
  const wb = XLSX.utils.book_new();

  // Sheet 1: All deals
  const sheet1Data = [
    ["ID","Brand","Contact","Phone","Platform","Stage","Source","Value (VND)","Notes","Ngày tạo","Cập nhật"],
    ...deals.map(d => [
      d.id, d.brand, d.contact, d.phone,
      Array.isArray(d.platform) ? d.platform.join(", ") : d.platform,
      d.stage, d.source, Number(d.value)||0, d.notes,
      fmtDate(d.createdAt), fmtDate(d.updatedAt)
    ])
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
  ws1["!cols"] = [8,18,16,14,20,10,14,14,24,12,12].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws1, "Tất cả Deals");

  // Sheet 2: Monthly summary
  const allMonths = [...new Set(deals.map(d => monthKey(d.createdAt)).filter(Boolean))].sort();
  const sheet2Data = [["Tháng","Leads mới","Win","Revenue Win (VND)","Tỷ lệ Win (%)"]];
  allMonths.forEach(m => {
    const mDeals = deals.filter(d => monthKey(d.createdAt) === m);
    const won = deals.filter(d => {
      const h = Array.isArray(d.stageHistory) ? d.stageHistory : [];
      return h.some(x => x.to === "Win" && monthKey(x.date) === m);
    });
    const rev = won.reduce((s,d)=>s+(Number(d.value)||0),0);
    const rate = mDeals.length > 0 ? Math.round((won.length/mDeals.length)*100) : 0;
    sheet2Data.push([monthLabel(m), mDeals.length, won.length, rev, rate+"%"]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  ws2["!cols"] = [16,12,10,20,14].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws2, "Tổng hợp tháng");

  // Sheet 3: Stage history log
  const sheet3Data = [["Brand","Từ Stage","Sang Stage","Ngày","Số ngày"]];
  deals.forEach(d => {
    const hist = Array.isArray(d.stageHistory) ? d.stageHistory.filter(h=>h.from) : [];
    hist.forEach((h, i) => {
      const prevDate = hist[i-1]?.date || d.createdAt;
      sheet3Data.push([d.brand, h.from, h.to, fmtDate(h.date), daysBetween(prevDate, h.date)]);
    });
  });
  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
  ws3["!cols"] = [18,12,12,14,10].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws3, "Lịch sử Stage");

  const month = reportMonth ? reportMonth.replace("-","_") : "all";
  XLSX.writeFile(wb, `GIP_Pipeline_${month}.xlsx`);
};

export default function App() {
  const [deals, setDeals] = useState([]);
  const [scriptUrl, setScriptUrl] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [modalDeal, setModalDeal] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [syncState, setSyncState] = useState("idle");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("pipeline");
  const [reportMonth, setReportMonth] = useState("");

  useEffect(() => {
    try { const r = localStorage.getItem("gip_deals"); if (r) setDeals(JSON.parse(r)); } catch {}
    try { const r = localStorage.getItem("gip_script_url"); if (r) setScriptUrl(r); } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) { try { localStorage.setItem("gip_deals", JSON.stringify(deals)); } catch {} }
  }, [deals, loaded]);

  useEffect(() => { if (!reportMonth) setReportMonth(monthKey(new Date().toISOString())); }, []);

  const saveDeal = (deal) => {
    const now = new Date().toISOString();
    if (deal.id) {
      setDeals(p => p.map(d => {
        if (d.id !== deal.id) return d;
        let history = Array.isArray(d.stageHistory) ? [...d.stageHistory] : [];
        if (d.stage !== deal.stage) history.push({ from: d.stage, to: deal.stage, date: now });
        return { ...deal, stageHistory: history, updatedAt: now };
      }));
    } else {
      setDeals(p => [...p, { ...deal, id: Date.now().toString(), stage: deal.stage||"Freeze", createdAt: now, updatedAt: now, stageHistory: [{ from: null, to: deal.stage||"Freeze", date: now }] }]);
    }
    setModalDeal(null);
  };

  const deleteDeal = (id) => { if (confirm("Xoá deal này?")) setDeals(p => p.filter(d => d.id !== id)); };

  const moveDeal = (id, toStage) => {
    const now = new Date().toISOString();
    setDeals(p => p.map(d => {
      if (d.id !== id || d.stage === toStage) return d;
      const history = Array.isArray(d.stageHistory) ? [...d.stageHistory] : [];
      history.push({ from: d.stage, to: toStage, date: now });
      return { ...d, stage: toStage, stageHistory: history, updatedAt: now };
    }));
  };

  const doSync = async (action) => {
    if (!scriptUrl) { setShowSetup(true); return; }
    setSyncState("syncing");
    try {
      let url = scriptUrl + "?action=" + action;
      if (action === "sync") url += "&data=" + btoa(unescape(encodeURIComponent(JSON.stringify(deals))));
      const r = await fetch(url);
      const json = await r.json();
      if (action === "read" && json.deals) {
        setDeals(json.deals.map(d => ({
          ...d,
          platform: d.platform ? d.platform.split(", ").filter(Boolean) : [],
          stageHistory: (() => { try { return JSON.parse(d.stageHistory||"[]"); } catch { return []; } })(),
        })));
      }
      setSyncState(json.success || json.deals ? "success" : "error");
    } catch { setSyncState("error"); }
    setTimeout(() => setSyncState("idle"), 3000);
  };

  const filtered = deals.filter(d => !search ||
    (d.brand||"").toLowerCase().includes(search.toLowerCase()) ||
    (d.contact||"").toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: deals.length,
    hot: deals.filter(d=>d.stage==="Hot").length,
    win: deals.filter(d=>d.stage==="Win").length,
    rev: deals.filter(d=>d.stage==="Win").reduce((s,d)=>s+(Number(d.value)||0),0),
  };

  const allMonths = [...new Set(deals.map(d=>monthKey(d.createdAt)).filter(Boolean))].sort().reverse();

  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif", background:"#f0f4f8", minHeight:"100vh", color:"#1a2a3a" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background:"#fff", borderBottom:"1px solid #dde6f0", padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"10px", boxShadow:"0 1px 4px rgba(0,80,160,0.07)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
          <div style={{ background:"linear-gradient(135deg,#1a6fba,#2196f3)", borderRadius:"10px", width:"36px", height:"36px", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:"800", color:"#fff", fontSize:"11px", letterSpacing:"0.05em", boxShadow:"0 2px 8px rgba(26,111,186,0.3)" }}>GIP</div>
          <div>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:"17px", color:"#1a6fba", lineHeight:1.1 }}>Sales Pipeline CRM</div>
            <div style={{ fontSize:"9px", color:"#90a8c0", letterSpacing:"0.08em", marginTop:"1px" }}>PHILIPPINES EXPANSION · GIP FULFILLMENT</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:"7px", alignItems:"center", flexWrap:"wrap" }}>
          <div style={{ display:"flex", background:"#f0f4f8", borderRadius:"8px", padding:"3px", gap:"2px" }}>
            {[["pipeline","📋 Pipeline"],["report","📊 Báo cáo"]].map(([key,label])=>(
              <button key={key} onClick={()=>setTab(key)}
                style={{ background:tab===key?"#fff":"transparent", border:"none", borderRadius:"6px", padding:"5px 13px", color:tab===key?"#1a6fba":"#90a8c0", fontWeight:tab===key?"700":"400", fontSize:"12px", cursor:"pointer", fontFamily:"inherit", boxShadow:tab===key?"0 1px 4px rgba(0,80,160,0.1)":"none" }}>
                {label}
              </button>
            ))}
          </div>
          {tab==="pipeline" && <>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Brand, contact..."
              style={{ background:"#f4f8fc", border:"1px solid #c8ddf0", borderRadius:"8px", padding:"7px 11px", color:"#1a2a3a", fontSize:"12px", outline:"none", width:"160px" }} />
            <Btn blue onClick={()=>setModalDeal({})}>+ Deal mới</Btn>
            <Btn onClick={()=>doSync("read")} disabled={syncState==="syncing"}>↓ Tải</Btn>
            <Btn onClick={()=>doSync("sync")} disabled={syncState==="syncing"}
              style={{ borderColor:syncState==="success"?"#80d0a8":syncState==="error"?"#f0a898":"#c8ddf0", color:syncState==="success"?"#1a7a45":syncState==="error"?"#c0392b":"#1a6fba" }}>
              {syncState==="syncing"?"⟳ Sync...":syncState==="success"?"✓ Synced!":syncState==="error"?"✗ Lỗi":"↑ Sync Sheets"}
            </Btn>
          </>}
          {tab==="report" && (
            <Btn blue onClick={()=>exportExcel(deals,reportMonth)}>⬇ Xuất Excel</Btn>
          )}
          <Btn onClick={()=>setShowSetup(true)} style={{ padding:"7px 10px", color:"#90a8c0" }}>⚙</Btn>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"flex", background:"#fff", borderBottom:"1px solid #dde6f0" }}>
        {[
          {label:"TỔNG LEADS",val:stats.total,col:"#1a6fba"},
          {label:"HOT LEADS",val:stats.hot,col:"#c0392b"},
          {label:"ĐÃ WIN",val:stats.win,col:"#1a7a45"},
          {label:"REV. DỰ KIẾN",val:stats.rev?`${(stats.rev/1e6).toFixed(0)}M ₫`:"—",col:"#b86e00"},
        ].map((s,i)=>(
          <div key={s.label} style={{ flex:1, padding:"10px 18px", borderRight:i<3?"1px solid #dde6f0":"none" }}>
            <div style={{ fontSize:"22px", fontWeight:"700", color:s.col, lineHeight:1 }}>{s.val}</div>
            <div style={{ fontSize:"9px", color:"#90a8c0", letterSpacing:"0.08em", marginTop:"3px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {tab==="pipeline"
        ? <KanbanBoard deals={filtered} dragOver={dragOver} setDragOver={setDragOver} draggingId={draggingId} setDraggingId={setDraggingId} moveDeal={moveDeal} onEdit={d=>setModalDeal(d)} onDelete={deleteDeal} onAdd={stage=>setModalDeal({stage})} />
        : <ReportView deals={deals} allMonths={allMonths} reportMonth={reportMonth} setReportMonth={setReportMonth} />
      }

      {modalDeal!==null && <DealModal deal={modalDeal} onSave={saveDeal} onClose={()=>setModalDeal(null)} />}
      {showSetup && <SetupModal url={scriptUrl} onSave={url=>{ setScriptUrl(url); try{localStorage.setItem("gip_script_url",url)}catch{} setShowSetup(false); }} onClose={()=>setShowSetup(false)} />}
    </div>
  );
}

function KanbanBoard({ deals, dragOver, setDragOver, draggingId, setDraggingId, moveDeal, onEdit, onDelete, onAdd }) {
  return (
    <div style={{ display:"flex", gap:"12px", padding:"18px 20px", overflowX:"auto", minHeight:"calc(100vh - 152px)", alignItems:"flex-start" }}>
      {STAGES.map(stage=>{
        const cfg=STAGE_CFG[stage];
        const stageDeals=deals.filter(d=>d.stage===stage);
        const isOver=dragOver===stage;
        return (
          <div key={stage}
            onDragOver={e=>{e.preventDefault();setDragOver(stage);}}
            onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragOver(null);}}
            onDrop={e=>{e.preventDefault();if(draggingId)moveDeal(draggingId,stage);setDragOver(null);setDraggingId(null);}}
            style={{ flex:"0 0 234px", background:isOver?cfg.head:"#fff", border:`1.5px solid ${isOver?cfg.border:"#dde6f0"}`, borderRadius:"14px", padding:"12px", transition:"all 0.15s", display:"flex", flexDirection:"column", gap:"8px", boxShadow:isOver?`0 4px 16px ${cfg.border}80`:"0 1px 4px rgba(0,80,160,0.07)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingBottom:"10px", borderBottom:`1.5px solid ${cfg.border}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:"7px" }}>
                <span style={{ fontSize:"15px" }}>{cfg.icon}</span>
                <span style={{ fontWeight:"700", color:cfg.color, fontSize:"13px" }}>{stage}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                {stageDeals.some(d=>d.value)&&<span style={{ fontSize:"10px", color:"#b86e00", fontWeight:"600" }}>{(stageDeals.reduce((s,d)=>s+(Number(d.value)||0),0)/1e6).toFixed(0)}M₫</span>}
                <span style={{ background:cfg.badge, color:cfg.color, borderRadius:"10px", padding:"1px 8px", fontSize:"11px", fontWeight:"700", border:`1px solid ${cfg.border}` }}>{stageDeals.length}</span>
              </div>
            </div>
            {stageDeals.map(deal=>(
              <DealCard key={deal.id} deal={deal} cfg={cfg}
                isDragging={draggingId===deal.id}
                onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDraggingId(deal.id);}}
                onDragEnd={()=>setDraggingId(null)}
                onEdit={()=>onEdit(deal)} onDelete={()=>onDelete(deal.id)} />
            ))}
            {stageDeals.length===0&&<div style={{ padding:"20px 0", textAlign:"center", color:isOver?cfg.color:"#c0cfd8", fontSize:"11px" }}>{isOver?"↓ Thả vào đây":"Chưa có deal"}</div>}
            <button onClick={()=>onAdd(stage)}
              style={{ background:"transparent", border:`1px dashed ${cfg.border}`, borderRadius:"8px", padding:"7px", color:"#90a8c0", fontSize:"12px", cursor:"pointer", width:"100%", fontFamily:"inherit", transition:"all 0.15s" }}
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

function DealCard({ deal, cfg, isDragging, onDragStart, onDragEnd, onEdit, onDelete }) {
  const [hover,setHover]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const platforms=Array.isArray(deal.platform)?deal.platform:(deal.platform?[deal.platform]:[]);
  const history=Array.isArray(deal.stageHistory)?deal.stageHistory:[];
  return (
    <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{ background:hover?cfg.head:"#fafcff", border:`1px solid ${hover?cfg.border:"#dde6f0"}`, borderRadius:"10px", padding:"11px", cursor:"grab", opacity:isDragging?0.4:1, transition:"all 0.12s", boxShadow:hover?`0 2px 10px ${cfg.border}80`:"0 1px 3px rgba(0,80,160,0.06)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"6px" }}>
        <div style={{ fontWeight:"700", color:"#1a2a3a", fontSize:"13px", lineHeight:1.3, flex:1 }}>{deal.brand||"—"}</div>
        {hover&&<div style={{ display:"flex", gap:"3px", flexShrink:0 }}>
          <MiniBtn onClick={onEdit} title="Sửa">✎</MiniBtn>
          <MiniBtn onClick={onDelete} title="Xoá" danger>✕</MiniBtn>
        </div>}
      </div>
      {deal.contact&&<div style={{ fontSize:"11px", color:"#6080a0", marginTop:"4px" }}>👤 {deal.contact}</div>}
      {deal.phone&&<div style={{ fontSize:"11px", color:"#6080a0", marginTop:"2px" }}>📞 {deal.phone}</div>}
      {platforms.length>0&&<div style={{ display:"flex", flexWrap:"wrap", gap:"4px", marginTop:"7px" }}>
        {platforms.map(p=><span key={p} style={{ background:cfg.badge, border:`1px solid ${cfg.border}`, borderRadius:"4px", padding:"1px 6px", fontSize:"10px", color:cfg.color, fontWeight:"500" }}>{p}</span>)}
      </div>}
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:"8px", alignItems:"center" }}>
        {deal.value?<span style={{ fontSize:"11px", color:"#b86e00", fontWeight:"700" }}>{Number(deal.value)>=1e6?`${(Number(deal.value)/1e6).toFixed(0)}M`:Number(deal.value).toLocaleString()}₫</span>:<span/>}
        {deal.source&&<span style={{ fontSize:"10px", color:"#90a8c0" }}>{deal.source}</span>}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:"8px", paddingTop:"7px", borderTop:"1px solid #eef3f8" }}>
        <span style={{ fontSize:"10px", color:"#a0b8d0" }}>📅 {fmtDate(deal.createdAt)||"—"}</span>
        {history.filter(h=>h.from).length>0&&<button onClick={e=>{e.stopPropagation();setShowHistory(v=>!v);}} style={{ background:"transparent", border:"none", fontSize:"10px", color:"#1a6fba", cursor:"pointer", fontFamily:"inherit", padding:0 }}>{showHistory?"▲ Ẩn":"🕐 Lịch sử"}</button>}
      </div>
      {showHistory&&history.filter(h=>h.from).length>0&&(
        <div style={{ marginTop:"8px", background:"#f4f8fc", borderRadius:"7px", padding:"8px", display:"flex", flexDirection:"column", gap:"4px" }}>
          {history.filter(h=>h.from).map((h,i)=>{
            const arr=history.filter(x=>x.from);
            const prevDate=arr[i-1]?.date||deal.createdAt;
            const days=daysBetween(prevDate,h.date);
            const fromCfg=STAGE_CFG[h.from]||{};
            const toCfg=STAGE_CFG[h.to]||{};
            return (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:"5px", fontSize:"10px" }}>
                <span style={{ color:fromCfg.color, fontWeight:"600" }}>{fromCfg.icon} {h.from}</span>
                <span style={{ color:"#c0cfd8" }}>→</span>
                <span style={{ color:toCfg.color, fontWeight:"600" }}>{toCfg.icon} {h.to}</span>
                <span style={{ color:"#a0b8d0", marginLeft:"auto" }}>{days>0?`${days}d · `:""}{fmtDate(h.date)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReportView({ deals, allMonths, reportMonth, setReportMonth }) {
  const currentMonth=monthKey(new Date().toISOString());
  const months=[...new Set([currentMonth,...allMonths])].sort().reverse();
  const monthDeals=deals.filter(d=>monthKey(d.createdAt)===reportMonth);
  const movedThisMonth=deals.flatMap(d=>{
    const hist=Array.isArray(d.stageHistory)?d.stageHistory:[];
    return hist.filter(h=>h.from&&monthKey(h.date)===reportMonth).map(h=>({...h,brand:d.brand}));
  });
  const wonThisMonth=deals.filter(d=>{
    const h=Array.isArray(d.stageHistory)?d.stageHistory:[];
    return h.some(x=>x.to==="Win"&&monthKey(x.date)===reportMonth);
  });
  const avgDays={};
  STAGES.forEach((st,i)=>{
    if(i===0)return;
    const from=STAGES[i-1];
    const transitions=deals.flatMap(d=>{
      const hist=Array.isArray(d.stageHistory)?d.stageHistory:[];
      return hist.filter(h=>h.from===from&&h.to===st).map((h,idx)=>{
        const prevDate=hist.slice(0,hist.indexOf(h)).reverse().find(x=>x.to===from)?.date||d.createdAt;
        return daysBetween(prevDate,h.date);
      });
    });
    avgDays[`${from}→${st}`]=transitions.length?Math.round(transitions.reduce((a,b)=>a+b,0)/transitions.length):null;
  });
  const stageCounts={};
  STAGES.forEach(s=>{stageCounts[s]=monthDeals.filter(d=>d.stage===s).length;});

  return (
    <div style={{ padding:"20px", maxWidth:"900px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"20px", flexWrap:"wrap" }}>
        <span style={{ fontFamily:"'Playfair Display',serif", fontSize:"17px", color:"#1a6fba" }}>📊 Báo cáo tháng</span>
        <select value={reportMonth} onChange={e=>setReportMonth(e.target.value)}
          style={{ background:"#fff", border:"1.5px solid #c8ddf0", borderRadius:"8px", padding:"7px 14px", color:"#1a2a3a", fontSize:"13px", outline:"none", fontFamily:"inherit", fontWeight:"600", cursor:"pointer" }}>
          {months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:"12px", marginBottom:"20px" }}>
        {[
          {label:"Leads mới",val:monthDeals.length,col:"#1a6fba",icon:"➕"},
          {label:"Chuyển stage",val:movedThisMonth.length,col:"#b86e00",icon:"🔄"},
          {label:"Deal Win",val:wonThisMonth.length,col:"#1a7a45",icon:"🏆"},
          {label:"Rev. Win",val:wonThisMonth.reduce((s,d)=>s+(Number(d.value)||0),0)?`${(wonThisMonth.reduce((s,d)=>s+(Number(d.value)||0),0)/1e6).toFixed(0)}M₫`:"—",col:"#c0392b",icon:"💰"},
        ].map(c=>(
          <div key={c.label} style={{ background:"#fff", border:"1px solid #dde6f0", borderRadius:"12px", padding:"14px 16px", boxShadow:"0 1px 4px rgba(0,80,160,0.07)" }}>
            <div style={{ fontSize:"20px", marginBottom:"4px" }}>{c.icon}</div>
            <div style={{ fontSize:"24px", fontWeight:"700", color:c.col, lineHeight:1 }}>{c.val}</div>
            <div style={{ fontSize:"10px", color:"#90a8c0", marginTop:"4px", letterSpacing:"0.05em" }}>{c.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px" }}>
        <div style={{ background:"#fff", border:"1px solid #dde6f0", borderRadius:"12px", padding:"16px", boxShadow:"0 1px 4px rgba(0,80,160,0.07)" }}>
          <div style={{ fontWeight:"700", color:"#1a2a3a", fontSize:"13px", marginBottom:"14px" }}>📋 Phân bổ theo stage</div>
          {STAGES.map(st=>{
            const cfg=STAGE_CFG[st];
            const cnt=stageCounts[st];
            const max=Math.max(...Object.values(stageCounts),1);
            return (
              <div key={st} style={{ marginBottom:"10px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
                  <span style={{ fontSize:"12px", color:cfg.color, fontWeight:"600" }}>{cfg.icon} {st}</span>
                  <span style={{ fontSize:"12px", color:"#6080a0", fontWeight:"600" }}>{cnt}</span>
                </div>
                <div style={{ background:"#f0f4f8", borderRadius:"4px", height:"6px" }}>
                  <div style={{ background:cfg.border, width:`${max>0?(cnt/max)*100:0}%`, height:"100%", borderRadius:"4px", transition:"width 0.5s" }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background:"#fff", border:"1px solid #dde6f0", borderRadius:"12px", padding:"16px", boxShadow:"0 1px 4px rgba(0,80,160,0.07)" }}>
          <div style={{ fontWeight:"700", color:"#1a2a3a", fontSize:"13px", marginBottom:"14px" }}>⏱ Avg ngày chuyển stage</div>
          {Object.entries(avgDays).map(([key,val])=>{
            const [from,to]=key.split("→");
            const fromCfg=STAGE_CFG[from]||{};
            const toCfg=STAGE_CFG[to]||{};
            return (
              <div key={key} style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"10px", background:"#f4f8fc", borderRadius:"8px", padding:"8px 10px" }}>
                <span style={{ fontSize:"11px", color:fromCfg.color, fontWeight:"600" }}>{fromCfg.icon} {from}</span>
                <span style={{ color:"#c0cfd8", fontSize:"12px" }}>→</span>
                <span style={{ fontSize:"11px", color:toCfg.color, fontWeight:"600" }}>{toCfg.icon} {to}</span>
                <span style={{ marginLeft:"auto", fontSize:"13px", fontWeight:"700", color:val!==null?"#1a6fba":"#c0cfd8" }}>{val!==null?`${val} ngày`:"—"}</span>
              </div>
            );
          })}
        </div>

        <div style={{ background:"#fff", border:"1px solid #dde6f0", borderRadius:"12px", padding:"16px", gridColumn:"1/-1", boxShadow:"0 1px 4px rgba(0,80,160,0.07)" }}>
          <div style={{ fontWeight:"700", color:"#1a2a3a", fontSize:"13px", marginBottom:"14px" }}>🔄 Lịch sử chuyển stage trong tháng</div>
          {movedThisMonth.length===0
            ?<div style={{ color:"#c0cfd8", fontSize:"12px", textAlign:"center", padding:"20px 0" }}>Chưa có chuyển stage nào trong tháng này</div>
            :<div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
              {movedThisMonth.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((h,i)=>{
                const fromCfg=STAGE_CFG[h.from]||{};
                const toCfg=STAGE_CFG[h.to]||{};
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:"10px", background:"#f4f8fc", borderRadius:"8px", padding:"8px 12px" }}>
                    <span style={{ fontSize:"12px", fontWeight:"700", color:"#1a2a3a", minWidth:"120px" }}>{h.brand||"—"}</span>
                    <span style={{ fontSize:"11px", color:fromCfg.color, fontWeight:"600" }}>{fromCfg.icon} {h.from}</span>
                    <span style={{ color:"#c0cfd8" }}>→</span>
                    <span style={{ fontSize:"11px", color:toCfg.color, fontWeight:"600" }}>{toCfg.icon} {h.to}</span>
                    <span style={{ marginLeft:"auto", fontSize:"11px", color:"#90a8c0" }}>{fmtDate(h.date)}</span>
                  </div>
                );
              })}
            </div>
          }
        </div>
      </div>
    </div>
  );
}

function Btn({ children, onClick, blue, disabled, style={} }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background:blue?"linear-gradient(135deg,#1a6fba,#2196f3)":"#fff", border:blue?"none":"1px solid #c8ddf0", borderRadius:"8px", padding:"7px 13px", color:blue?"#fff":"#1a6fba", fontWeight:blue?"700":"500", fontSize:"12px", cursor:disabled?"default":"pointer", opacity:disabled?0.6:1, fontFamily:"inherit", boxShadow:blue?"0 2px 6px rgba(26,111,186,0.25)":"none", ...style }}>
      {children}
    </button>
  );
}
function Field({ label, children, span }) {
  return (
    <div style={span?{gridColumn:"1/-1"}:{}}>
      <div style={{ fontSize:"10px", color:"#90a8c0", fontWeight:"600", letterSpacing:"0.06em", marginBottom:"5px" }}>{label.toUpperCase()}</div>
      {children}
    </div>
  );
}
function Inp({ value, onChange, placeholder, type="text", multiline }) {
  const base={ background:"#f4f8fc", border:"1px solid #c8ddf0", borderRadius:"8px", padding:"8px 10px", color:"#1a2a3a", fontSize:"13px", width:"100%", outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
  return multiline
    ?<textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={3} style={{...base,resize:"vertical"}} />
    :<input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={base} />;
}
function Modal({ children, onClose }) {
  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{ position:"fixed", inset:0, background:"rgba(0,40,80,0.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:"12px", backdropFilter:"blur(4px)" }}>
      <div style={{ background:"#fff", border:"1px solid #dde6f0", borderRadius:"16px", padding:"26px", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 8px 40px rgba(0,80,160,0.15)" }}>
        {children}
      </div>
    </div>
  );
}
function MiniBtn({ onClick, children, danger, title }) {
  return (
    <button onClick={e=>{e.stopPropagation();onClick();}} title={title}
      style={{ background:"transparent", border:"none", borderRadius:"4px", width:"20px", height:"20px", color:danger?"#c0392b":"#90a8c0", cursor:"pointer", fontSize:"12px", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit" }}>
      {children}
    </button>
  );
}

function DealModal({ deal, onSave, onClose }) {
  const isNew=!deal.id;
  const [f,setF]=useState({ brand:"", contact:"", phone:"", platform:[], stage:"Freeze", source:"", value:"", notes:"", ...deal });
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const togglePlatform=p=>s("platform",f.platform.includes(p)?f.platform.filter(x=>x!==p):[...f.platform,p]);
  const history=Array.isArray(f.stageHistory)?f.stageHistory.filter(h=>h.from):[];

  return (
    <Modal onClose={onClose}>
      <div style={{ width:"480px", maxWidth:"90vw" }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:"18px", color:"#1a6fba", marginBottom:"18px" }}>
          {isNew?"✦ Thêm Deal Mới":"✦ Chỉnh sửa Deal"}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"13px" }}>
          <Field label="Tên Brand *" span><Inp value={f.brand} onChange={v=>s("brand",v)} placeholder="Ví dụ: Cafuné, Owen, BOHEE..." /></Field>
          <Field label="Người liên hệ"><Inp value={f.contact} onChange={v=>s("contact",v)} placeholder="Tên người phụ trách" /></Field>
          <Field label="Số điện thoại"><Inp value={f.phone} onChange={v=>s("phone",v)} placeholder="0901..." /></Field>
          <Field label="Giai đoạn Pipeline" span>
            <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
              {STAGES.map(st=>{
                const cfg=STAGE_CFG[st]; const active=f.stage===st;
                return <button key={st} onClick={()=>s("stage",st)} style={{ background:active?cfg.badge:"#f4f8fc", border:`1.5px solid ${active?cfg.border:"#dde6f0"}`, borderRadius:"8px", padding:"5px 12px", color:active?cfg.color:"#90a8c0", fontSize:"12px", fontWeight:active?"700":"400", cursor:"pointer", fontFamily:"inherit", transition:"all 0.12s" }}>{cfg.icon} {st}</button>;
              })}
            </div>
          </Field>
          <Field label="Platform" span>
            <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
              {PLATFORMS.map(p=>{
                const active=f.platform.includes(p);
                return <button key={p} onClick={()=>togglePlatform(p)} style={{ background:active?"#e8f3fc":"#f4f8fc", border:`1.5px solid ${active?"#90c0ef":"#dde6f0"}`, borderRadius:"8px", padding:"5px 12px", color:active?"#1a6fba":"#90a8c0", fontSize:"12px", fontWeight:active?"600":"400", cursor:"pointer", fontFamily:"inherit" }}>{p}</button>;
              })}
            </div>
          </Field>
          <Field label="Nguồn lead">
            <select value={f.source} onChange={e=>s("source",e.target.value)} style={{ background:"#f4f8fc", border:"1px solid #c8ddf0", borderRadius:"8px", padding:"8px 10px", color:f.source?"#1a2a3a":"#90a8c0", fontSize:"13px", width:"100%", outline:"none", fontFamily:"inherit" }}>
              <option value="">Chọn nguồn...</option>
              {Object.entries(SOURCE_GROUPS).map(([group, items]) => (
                <optgroup key={group} label={`── ${group}`}>
                  {items.map(src => <option key={`${group}-${src}`} value={`${group}: ${src}`}>{src}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Giá trị dự kiến (VND)"><Inp value={f.value} onChange={v=>s("value",v)} placeholder="50000000" type="number" /></Field>
          <Field label="Ghi chú" span><Inp value={f.notes} onChange={v=>s("notes",v)} placeholder="Ghi chú thêm..." multiline /></Field>
          {!isNew&&history.length>0&&(
            <Field label="Lịch sử chuyển stage" span>
              <div style={{ background:"#f4f8fc", borderRadius:"8px", padding:"10px", display:"flex", flexDirection:"column", gap:"6px" }}>
                {history.map((h,i)=>{
                  const fromCfg=STAGE_CFG[h.from]||{}; const toCfg=STAGE_CFG[h.to]||{};
                  const prevDate=history[i-1]?.date||f.createdAt;
                  const days=daysBetween(prevDate,h.date);
                  return (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:"7px", fontSize:"11px" }}>
                      <span style={{ color:fromCfg.color, fontWeight:"600" }}>{fromCfg.icon} {h.from}</span>
                      <span style={{ color:"#c0cfd8" }}>→</span>
                      <span style={{ color:toCfg.color, fontWeight:"600" }}>{toCfg.icon} {h.to}</span>
                      <span style={{ color:"#a0b8d0", marginLeft:"auto" }}>{days>0?`${days} ngày · `:""}{fmtDate(h.date)}</span>
                    </div>
                  );
                })}
              </div>
            </Field>
          )}
        </div>
        {!isNew&&f.createdAt&&<div style={{ fontSize:"11px", color:"#a0b8d0", marginTop:"12px" }}>📅 Ngày tạo: {fmtDate(f.createdAt)} · Cập nhật: {fmtDate(f.updatedAt)}</div>}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:"8px", marginTop:"16px" }}>
          <Btn onClick={onClose}>Huỷ</Btn>
          <Btn blue onClick={()=>{ if(!f.brand.trim())return alert("Vui lòng nhập tên Brand!"); onSave(f); }}>{isNew?"Tạo Deal":"Lưu thay đổi"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function SetupModal({ url, onSave, onClose }) {
  const [inputUrl,setInputUrl]=useState(url||"");
  const [copied,setCopied]=useState(false);
  const copy=()=>{ navigator.clipboard.writeText(SCRIPT_CODE); setCopied(true); setTimeout(()=>setCopied(false),2000); };
  return (
    <Modal onClose={onClose}>
      <div style={{ width:"540px", maxWidth:"92vw" }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:"18px", color:"#1a6fba", marginBottom:"14px" }}>⚙ Kết nối Google Sheets</div>
        <div style={{ background:"#f0f7ff", border:"1px solid #c8ddf0", borderRadius:"10px", padding:"14px", marginBottom:"14px" }}>
          <div style={{ fontSize:"11px", color:"#1a6fba", fontWeight:"600", marginBottom:"10px" }}>📋 Hướng dẫn setup:</div>
          {["Mở Google Sheets → Extensions → Apps Script","Xoá code cũ, paste code bên dưới vào","Deploy → New deployment → Web app","Execute as: Me  |  Who has access: Anyone → Deploy","Copy Deployment URL và paste vào ô bên dưới"].map((step,i)=>(
            <div key={i} style={{ display:"flex", gap:"10px", marginBottom:"6px", alignItems:"flex-start" }}>
              <span style={{ background:"#1a6fba", color:"#fff", borderRadius:"50%", width:"18px", height:"18px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"10px", fontWeight:"700", flexShrink:0 }}>{i+1}</span>
              <span style={{ fontSize:"12px", color:"#2a4a7a", lineHeight:1.5 }}>{step}</span>
            </div>
          ))}
        </div>
        <div style={{ marginBottom:"14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
            <span style={{ fontSize:"10px", color:"#90a8c0", fontWeight:"600", letterSpacing:"0.06em" }}>APPS SCRIPT CODE</span>
            <button onClick={copy} style={{ background:copied?"#e6f8ee":"#f4f8fc", border:`1px solid ${copied?"#80d0a8":"#c8ddf0"}`, borderRadius:"6px", padding:"3px 10px", color:copied?"#1a7a45":"#1a6fba", fontSize:"11px", cursor:"pointer", fontFamily:"inherit" }}>{copied?"✓ Đã copy!":"📋 Copy code"}</button>
          </div>
          <pre style={{ background:"#f4f8fc", border:"1px solid #dde6f0", borderRadius:"8px", padding:"12px", fontSize:"10px", color:"#6080a0", overflowX:"auto", maxHeight:"140px", overflowY:"auto", margin:0, lineHeight:1.6 }}>{SCRIPT_CODE}</pre>
        </div>
        <Field label="Web App URL"><Inp value={inputUrl} onChange={setInputUrl} placeholder="https://script.google.com/macros/s/.../exec" /></Field>
        <div style={{ display:"flex", justifyContent:"flex-end", gap:"8px", marginTop:"16px" }}>
          <Btn onClick={onClose}>Đóng</Btn>
          <Btn blue onClick={()=>onSave(inputUrl.trim())}>Lưu kết nối</Btn>
        </div>
      </div>
    </Modal>
  );
}
