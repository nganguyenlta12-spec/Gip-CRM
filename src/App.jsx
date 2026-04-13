import { useState, useEffect } from "react";
import * as XLSX from "xlsx";

const STAGES = ["Data Thô", "Freeze", "Cold", "Warm", "Hot", "Win"];
const PLATFORMS = ["Shopee", "Lazada", "TikTok Shop", "Website", "Khác"];
const PICS = ["GIPMANA", "GIP01", "GIP02", "GIP03", "GIP04", "GIP05", "GIP06"];
const SOURCE_GROUPS = {
  "Cá nhân": ["Facebook", "Zalo", "Group", "Khách giới thiệu", "Khác"],
  "Sếp Loki": ["Facebook", "Zalo", "Group", "Khách giới thiệu", "Khác"],
};

const STAGE_CFG = {
  "Data Thô": { icon: "🗂️", color: "#6b7c93", border: "#c8d4e0", badge: "#eef2f6", head: "#f5f7fa" },
  Freeze:     { icon: "❄️", color: "#1a6fba", border: "#b3d4f0", badge: "#e8f3fc", head: "#f0f7ff" },
  Cold:       { icon: "🌊", color: "#0e5fa3", border: "#90c0ef", badge: "#ddeefa", head: "#eaf5ff" },
  Warm:       { icon: "☀️", color: "#b86e00", border: "#f0cc80", badge: "#fff8e6", head: "#fffbf0" },
  Hot:        { icon: "🔥", color: "#c0392b", border: "#f0a898", badge: "#fdecea", head: "#fff5f4" },
  Win:        { icon: "🏆", color: "#1a7a45", border: "#80d0a8", badge: "#e6f8ee", head: "#f0fdf6" },
};

const SCRIPT_CODE = `function doGet(e){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sh=ss.getSheetByName("Pipeline")||ss.getActiveSheet();
  var act=e.parameter.action;
  if(act==="sync"){
    var deals=JSON.parse(decodeURIComponent(escape(atob(e.parameter.data))));
    sh.clearContents();
    sh.appendRow(["ID","Brand","Contact","Phone","Platform","Stage","PIC","Source","Value","Notes","Created","Updated","StageHistory"]);
    deals.forEach(function(d){
      var notesText=Array.isArray(d.notes)?d.notes.map(function(n){return "["+n.date+"]: "+n.text;}).join(" || "):(d.notes||"");
      sh.appendRow([d.id,d.brand||"",d.contact||"",d.phone||"",
        Array.isArray(d.platform)?d.platform.join(", "):d.platform||"",
        d.stage||"",d.pic||"",d.source||"",d.value||"",notesText,
        d.createdAt||"",d.updatedAt||"",JSON.stringify(d.stageHistory||[])]);
    });
    return out({success:true,count:deals.length});
  }
  if(act==="read"){
    var data=sh.getDataRange().getValues();
    if(data.length<=1)return out({deals:[]});
    var keys=["id","brand","contact","phone","platform","stage","pic","source","value","notes","createdAt","updatedAt","stageHistory"];
    var rows=data.slice(1).map(function(r){var o={};keys.forEach(function(k,i){o[k]=String(r[i]||"")});return o});
    return out({deals:rows});
  }
  return out({error:"Unknown action"});
}
function out(d){return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);}`;

// ── Helpers ───────────────────────────────────────────────
const fmtDate = (iso) => { if(!iso) return ""; const d=new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
const fmtDT = (iso) => { if(!iso) return ""; const d=new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const daysBetween = (a,b) => Math.max(0,Math.round((new Date(b)-new Date(a))/86400000));
const monthKey = (iso) => { if(!iso) return ""; const d=new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const monthLabel = (key) => { if(!key) return ""; const [y,m]=key.split("-"); return `Tháng ${parseInt(m)}/${y}`; };
const parseNotes = (notes) => Array.isArray(notes) ? notes : [];

// ── Excel Export ──────────────────────────────────────────
const exportExcel = (deals, reportMonth) => {
  const wb = XLSX.utils.book_new();
  // Sheet 1: All deals
  const ws1 = XLSX.utils.aoa_to_sheet([
    ["Brand","Contact","Phone","Platform","Stage","PIC","Source","Value (VND)","Ghi chú gần nhất","Ngày tạo"],
    ...deals.map(d => {
      const notes = parseNotes(d.notes);
      return [d.brand,d.contact,d.phone,Array.isArray(d.platform)?d.platform.join(", "):d.platform,d.stage,d.pic||"",d.source,Number(d.value)||0,notes.length?notes[notes.length-1].text:"",fmtDate(d.createdAt)];
    })
  ]);
  ws1["!cols"]=[18,16,14,20,12,10,18,14,30,12].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws1,"Tất cả Deals");
  // Sheet 2: Notes log
  const ws2 = XLSX.utils.aoa_to_sheet([["Brand","PIC","Ngày giờ","Ghi chú"],...deals.flatMap(d=>parseNotes(d.notes).map(n=>[d.brand,d.pic||"",fmtDT(n.date),n.text]))]);
  ws2["!cols"]=[18,10,14,50].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws2,"Nhật ký ghi chú");
  // Sheet 3: Monthly
  const months=[...new Set(deals.map(d=>monthKey(d.createdAt)).filter(Boolean))].sort();
  const ws3 = XLSX.utils.aoa_to_sheet([["Tháng","Leads mới","Win","Revenue Win","Tỷ lệ Win"],...months.map(m=>{
    const md=deals.filter(d=>monthKey(d.createdAt)===m);
    const won=deals.filter(d=>(Array.isArray(d.stageHistory)?d.stageHistory:[]).some(x=>x.to==="Win"&&monthKey(x.date)===m));
    return [monthLabel(m),md.length,won.length,won.reduce((s,d)=>s+(Number(d.value)||0),0),md.length?Math.round(won.length/md.length*100)+"%":"0%"];
  })]);
  ws3["!cols"]=[16,12,10,20,12].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws3,"Tổng hợp tháng");
  // Sheet 4: Stage history
  const ws4 = XLSX.utils.aoa_to_sheet([["Brand","PIC","Từ","Sang","Ngày","Số ngày"],...deals.flatMap(d=>{
    const hist=(Array.isArray(d.stageHistory)?d.stageHistory:[]).filter(h=>h.from);
    return hist.map((h,i)=>[d.brand,d.pic||"",h.from,h.to,fmtDate(h.date),daysBetween(hist[i-1]?.date||d.createdAt,h.date)]);
  })]);
  ws4["!cols"]=[18,10,12,12,14,10].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws4,"Lịch sử Stage");
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

  useEffect(()=>{ try{const r=localStorage.getItem("gip_deals");if(r)setDeals(JSON.parse(r));}catch{} try{const r=localStorage.getItem("gip_script_url");if(r)setScriptUrl(r);}catch{} setLoaded(true); },[]);
  useEffect(()=>{ if(loaded){try{localStorage.setItem("gip_deals",JSON.stringify(deals));}catch{}} },[deals,loaded]);
  useEffect(()=>{ if(!reportMonth)setReportMonth(monthKey(new Date().toISOString())); },[]);

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
      setDeals(p=>[...p,{...deal,id:Date.now().toString(),stage:deal.stage||"Data Thô",createdAt:now,updatedAt:now,notes:parseNotes(deal.notes),stageHistory:[{from:null,to:deal.stage||"Data Thô",date:now}]}]);
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
        setDeals(json.deals.map(d=>({...d,platform:d.platform?d.platform.split(", ").filter(Boolean):[],notes:parseNotes(d.notes),stageHistory:(()=>{try{return JSON.parse(d.stageHistory||"[]");}catch{return [];}})()})));
      }
      setSyncState(json.success||json.deals?"success":"error");
    }catch{setSyncState("error");}
    setTimeout(()=>setSyncState("idle"),3000);
  };

  const filtered=deals.filter(d=>{
    const matchSearch=!search||(d.brand||"").toLowerCase().includes(search.toLowerCase())||(d.contact||"").toLowerCase().includes(search.toLowerCase());
    const matchPIC=!filterPIC||d.pic===filterPIC;
    return matchSearch&&matchPIC;
  });

  const stats={
    total:deals.length,
    hot:deals.filter(d=>d.stage==="Hot").length,
    win:deals.filter(d=>d.stage==="Win").length,
    rev:deals.reduce((s,d)=>s+(Number(d.value)||0),0),
  };
  const allMonths=[...new Set(deals.map(d=>monthKey(d.createdAt)).filter(Boolean))].sort().reverse();

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#f0f4f8",minHeight:"100vh",color:"#1a2a3a"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@600&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #dde6f0",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"10px",boxShadow:"0 1px 4px rgba(0,80,160,0.07)"}}>
        <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
          <div style={{background:"linear-gradient(135deg,#1a6fba,#2196f3)",borderRadius:"10px",width:"36px",height:"36px",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"800",color:"#fff",fontSize:"11px",boxShadow:"0 2px 8px rgba(26,111,186,0.3)"}}>GIP</div>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:"17px",color:"#1a6fba",lineHeight:1.1}}>Sales Pipeline CRM</div>
            <div style={{fontSize:"9px",color:"#90a8c0",letterSpacing:"0.08em",marginTop:"1px"}}>PHILIPPINES EXPANSION · GIP FULFILLMENT</div>
          </div>
        </div>
        <div style={{display:"flex",gap:"7px",alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",background:"#f0f4f8",borderRadius:"8px",padding:"3px",gap:"2px"}}>
            {[["pipeline","📋 Pipeline"],["report","📊 Báo cáo"]].map(([key,label])=>(
              <button key={key} onClick={()=>setTab(key)} style={{background:tab===key?"#fff":"transparent",border:"none",borderRadius:"6px",padding:"5px 13px",color:tab===key?"#1a6fba":"#90a8c0",fontWeight:tab===key?"700":"400",fontSize:"12px",cursor:"pointer",fontFamily:"inherit",boxShadow:tab===key?"0 1px 4px rgba(0,80,160,0.1)":"none"}}>{label}</button>
            ))}
          </div>
          {tab==="pipeline"&&<>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Brand, contact..." style={{background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"7px 11px",color:"#1a2a3a",fontSize:"12px",outline:"none",width:"140px"}}/>
            <select value={filterPIC} onChange={e=>setFilterPIC(e.target.value)} style={{background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"7px 10px",color:filterPIC?"#1a2a3a":"#90a8c0",fontSize:"12px",outline:"none",fontFamily:"inherit"}}>
              <option value="">Tất cả PIC</option>
              {PICS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
            <Btn blue onClick={()=>setModalDeal({})}>+ Deal mới</Btn>
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
        {[{label:"TỔNG LEADS",val:stats.total,col:"#1a6fba"},{label:"HOT LEADS",val:stats.hot,col:"#c0392b"},{label:"ĐÃ WIN",val:stats.win,col:"#1a7a45"},{label:"TỔNG REV.",val:stats.rev?`${(stats.rev/1e6).toFixed(1)}M ₫`:"—",col:"#b86e00"}].map((s,i)=>(
          <div key={s.label} style={{flex:1,padding:"10px 18px",borderRight:i<3?"1px solid #dde6f0":"none"}}>
            <div style={{fontSize:"22px",fontWeight:"700",color:s.col,lineHeight:1}}>{s.val}</div>
            <div style={{fontSize:"9px",color:"#90a8c0",letterSpacing:"0.08em",marginTop:"3px"}}>{s.label}</div>
          </div>
        ))}
      </div>

      {tab==="pipeline"
        ?<KanbanBoard deals={filtered} dragOver={dragOver} setDragOver={setDragOver} draggingId={draggingId} setDraggingId={setDraggingId} moveDeal={moveDeal} onEdit={d=>setModalDeal(d)} onDelete={deleteDeal} onAdd={stage=>setModalDeal({stage})}/>
        :<ReportView deals={deals} allMonths={allMonths} reportMonth={reportMonth} setReportMonth={setReportMonth} reportPIC={reportPIC} setReportPIC={setReportPIC}/>
      }
      {modalDeal!==null&&<DealModal deal={modalDeal} onSave={saveDeal} onClose={()=>setModalDeal(null)}/>}
      {showSetup&&<SetupModal url={scriptUrl} onSave={url=>{setScriptUrl(url);try{localStorage.setItem("gip_script_url",url)}catch{}setShowSetup(false);}} onClose={()=>setShowSetup(false)}/>}
    </div>
  );
}

// ── Kanban ────────────────────────────────────────────────
function KanbanBoard({deals,dragOver,setDragOver,draggingId,setDraggingId,moveDeal,onEdit,onDelete,onAdd}){
  return(
    <div style={{display:"flex",gap:"12px",padding:"18px 20px",overflowX:"auto",minHeight:"calc(100vh - 152px)",alignItems:"flex-start"}}>
      {STAGES.map(stage=>{
        const cfg=STAGE_CFG[stage];
        const sd=deals.filter(d=>d.stage===stage);
        const isOver=dragOver===stage;
        const rev=sd.reduce((s,d)=>s+(Number(d.value)||0),0);
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
                </div>
                <span style={{background:cfg.badge,color:cfg.color,borderRadius:"10px",padding:"1px 8px",fontSize:"11px",fontWeight:"700",border:`1px solid ${cfg.border}`}}>{sd.length}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"5px"}}>
                <span style={{fontSize:"10px",color:"#90a8c0"}}>Revenue:</span>
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
            <button onClick={()=>onAdd(stage)}
              style={{background:"transparent",border:`1px dashed ${cfg.border}`,borderRadius:"8px",padding:"7px",color:"#90a8c0",fontSize:"12px",cursor:"pointer",width:"100%",fontFamily:"inherit",transition:"all 0.15s"}}
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
  const [showHistory,setShowHistory]=useState(false);
  const [showNotes,setShowNotes]=useState(false);
  const platforms=Array.isArray(deal.platform)?deal.platform:(deal.platform?[deal.platform]:[]);
  const history=(Array.isArray(deal.stageHistory)?deal.stageHistory:[]).filter(h=>h.from);
  const notes=parseNotes(deal.notes);
  return(
    <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{background:hover?cfg.head:"#fafcff",border:`1px solid ${hover?cfg.border:"#dde6f0"}`,borderRadius:"10px",padding:"11px",cursor:"grab",opacity:isDragging?0.4:1,transition:"all 0.12s",boxShadow:hover?`0 2px 10px ${cfg.border}80`:"0 1px 3px rgba(0,80,160,0.06)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"6px"}}>
        <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",lineHeight:1.3,flex:1}}>{deal.brand||"—"}</div>
        {hover&&<div style={{display:"flex",gap:"3px",flexShrink:0}}>
          <MiniBtn onClick={onEdit} title="Sửa">✎</MiniBtn>
          <MiniBtn onClick={onDelete} title="Xoá" danger>✕</MiniBtn>
        </div>}
      </div>
      {deal.pic&&<div style={{fontSize:"10px",color:"#fff",background:cfg.color,borderRadius:"4px",padding:"1px 6px",display:"inline-block",marginTop:"4px",fontWeight:"600"}}>{deal.pic}</div>}
      {deal.contact&&<div style={{fontSize:"11px",color:"#6080a0",marginTop:"4px"}}>👤 {deal.contact}</div>}
      {deal.phone&&<div style={{fontSize:"11px",color:"#6080a0",marginTop:"2px"}}>📞 {deal.phone}</div>}
      {platforms.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:"4px",marginTop:"7px"}}>
        {platforms.map(p=><span key={p} style={{background:cfg.badge,border:`1px solid ${cfg.border}`,borderRadius:"4px",padding:"1px 6px",fontSize:"10px",color:cfg.color,fontWeight:"500"}}>{p}</span>)}
      </div>}
      <div style={{display:"flex",justifyContent:"space-between",marginTop:"8px",alignItems:"center"}}>
        {deal.value?<span style={{fontSize:"11px",color:"#b86e00",fontWeight:"700"}}>{Number(deal.value)>=1e6?`${(Number(deal.value)/1e6).toFixed(0)}M`:Number(deal.value).toLocaleString()}₫</span>:<span/>}
        {deal.source&&<span style={{fontSize:"10px",color:"#90a8c0"}}>{deal.source}</span>}
      </div>
      {/* Last note preview */}
      {notes.length>0&&<div style={{marginTop:"7px",background:"#f8f9fb",borderRadius:"6px",padding:"5px 8px",fontSize:"10px",color:"#6080a0",borderLeft:`2px solid ${cfg.border}`}}>
        💬 {notes[notes.length-1].text.length>50?notes[notes.length-1].text.slice(0,50)+"...":notes[notes.length-1].text}
      </div>}
      {/* Footer */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"8px",paddingTop:"7px",borderTop:"1px solid #eef3f8"}}>
        <span style={{fontSize:"10px",color:"#a0b8d0"}}>📅 {fmtDate(deal.createdAt)||"—"}</span>
        <div style={{display:"flex",gap:"6px"}}>
          {notes.length>0&&<button onClick={e=>{e.stopPropagation();setShowNotes(v=>!v);}} style={{background:"transparent",border:"none",fontSize:"10px",color:"#b86e00",cursor:"pointer",fontFamily:"inherit",padding:0}}>💬 {notes.length}</button>}
          {history.length>0&&<button onClick={e=>{e.stopPropagation();setShowHistory(v=>!v);}} style={{background:"transparent",border:"none",fontSize:"10px",color:"#1a6fba",cursor:"pointer",fontFamily:"inherit",padding:0}}>🕐 {history.length}</button>}
        </div>
      </div>
      {/* Notes log */}
      {showNotes&&notes.length>0&&(
        <div style={{marginTop:"8px",background:"#fffbf0",border:"1px solid #f0cc80",borderRadius:"8px",padding:"8px",display:"flex",flexDirection:"column",gap:"5px",maxHeight:"140px",overflowY:"auto"}}>
          {[...notes].reverse().map((n,i)=>(
            <div key={i} style={{fontSize:"11px"}}>
              <div style={{color:"#90a8c0",fontSize:"9px",marginBottom:"2px"}}>🕐 {fmtDT(n.date)}</div>
              <div style={{color:"#1a2a3a",lineHeight:1.4}}>{n.text}</div>
              {i<notes.length-1&&<div style={{borderBottom:"1px solid #f0e0b0",marginTop:"5px"}}/>}
            </div>
          ))}
        </div>
      )}
      {/* Stage history */}
      {showHistory&&history.length>0&&(
        <div style={{marginTop:"8px",background:"#f4f8fc",borderRadius:"7px",padding:"8px",display:"flex",flexDirection:"column",gap:"4px"}}>
          {history.map((h,i)=>{
            const arr=history;const prevDate=arr[i-1]?.date||deal.createdAt;
            const fromCfg=STAGE_CFG[h.from]||{};const toCfg=STAGE_CFG[h.to]||{};
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px"}}>
                <span style={{color:fromCfg.color,fontWeight:"600"}}>{fromCfg.icon} {h.from}</span>
                <span style={{color:"#c0cfd8"}}>→</span>
                <span style={{color:toCfg.color,fontWeight:"600"}}>{toCfg.icon} {h.to}</span>
                <span style={{color:"#a0b8d0",marginLeft:"auto"}}>{daysBetween(prevDate,h.date)>0?`${daysBetween(prevDate,h.date)}d · `:""}{fmtDate(h.date)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Report View ───────────────────────────────────────────
function ReportView({deals,allMonths,reportMonth,setReportMonth,reportPIC,setReportPIC}){
  const currentMonth=monthKey(new Date().toISOString());
  const months=[...new Set([currentMonth,...allMonths])].sort().reverse();
  const picDeals=reportPIC==="all"?deals:deals.filter(d=>d.pic===reportPIC);
  const monthDeals=picDeals.filter(d=>monthKey(d.createdAt)===reportMonth);
  const movedThisMonth=picDeals.flatMap(d=>(Array.isArray(d.stageHistory)?d.stageHistory:[]).filter(h=>h.from&&monthKey(h.date)===reportMonth).map(h=>({...h,brand:d.brand,pic:d.pic})));
  const wonThisMonth=picDeals.filter(d=>(Array.isArray(d.stageHistory)?d.stageHistory:[]).some(x=>x.to==="Win"&&monthKey(x.date)===reportMonth));

  // Avg days per transition
  const avgDays={};
  STAGES.forEach((st,i)=>{
    if(i===0)return;
    const from=STAGES[i-1];
    const transitions=picDeals.flatMap(d=>{
      const hist=(Array.isArray(d.stageHistory)?d.stageHistory:[]);
      return hist.filter(h=>h.from===from&&h.to===st).map(h=>{
        const prev=hist.slice(0,hist.indexOf(h)).reverse().find(x=>x.to===from)?.date||d.createdAt;
        return daysBetween(prev,h.date);
      });
    });
    avgDays[`${from}→${st}`]=transitions.length?Math.round(transitions.reduce((a,b)=>a+b,0)/transitions.length):null;
  });

  // PIC performance for total view
  const picStats=PICS.map(pic=>{
    const pd=deals.filter(d=>d.pic===pic);
    const won=pd.filter(d=>(Array.isArray(d.stageHistory)?d.stageHistory:[]).some(x=>x.to==="Win"&&monthKey(x.date)===reportMonth));
    const hot=pd.filter(d=>d.stage==="Hot").length;
    return {pic,total:pd.length,hot,win:won.length,rev:won.reduce((s,d)=>s+(Number(d.value)||0),0)};
  }).filter(p=>p.total>0);

  return(
    <div style={{padding:"20px",maxWidth:"960px"}}>
      {/* Filters */}
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"20px",flexWrap:"wrap"}}>
        <span style={{fontFamily:"'Playfair Display',serif",fontSize:"17px",color:"#1a6fba"}}>📊 Báo cáo</span>
        <select value={reportMonth} onChange={e=>setReportMonth(e.target.value)} style={{background:"#fff",border:"1.5px solid #c8ddf0",borderRadius:"8px",padding:"7px 14px",color:"#1a2a3a",fontSize:"13px",outline:"none",fontFamily:"inherit",fontWeight:"600",cursor:"pointer"}}>
          {months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <div style={{display:"flex",background:"#f0f4f8",borderRadius:"8px",padding:"3px",gap:"2px",flexWrap:"wrap"}}>
          <button onClick={()=>setReportPIC("all")} style={{background:reportPIC==="all"?"#fff":"transparent",border:"none",borderRadius:"6px",padding:"5px 12px",color:reportPIC==="all"?"#1a6fba":"#90a8c0",fontWeight:reportPIC==="all"?"700":"400",fontSize:"12px",cursor:"pointer",fontFamily:"inherit",boxShadow:reportPIC==="all"?"0 1px 4px rgba(0,80,160,0.1)":"none"}}>Tất cả</button>
          {PICS.map(p=>(
            <button key={p} onClick={()=>setReportPIC(p)} style={{background:reportPIC===p?"#fff":"transparent",border:"none",borderRadius:"6px",padding:"5px 12px",color:reportPIC===p?"#1a6fba":"#90a8c0",fontWeight:reportPIC===p?"700":"400",fontSize:"12px",cursor:"pointer",fontFamily:"inherit",boxShadow:reportPIC===p?"0 1px 4px rgba(0,80,160,0.1)":"none"}}>{p}</button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:"12px",marginBottom:"20px"}}>
        {[
          {label:"Leads mới",val:monthDeals.length,col:"#1a6fba",icon:"➕"},
          {label:"Chuyển stage",val:movedThisMonth.length,col:"#b86e00",icon:"🔄"},
          {label:"Deal Win",val:wonThisMonth.length,col:"#1a7a45",icon:"🏆"},
          {label:"Rev. Win",val:wonThisMonth.reduce((s,d)=>s+(Number(d.value)||0),0)?`${(wonThisMonth.reduce((s,d)=>s+(Number(d.value)||0),0)/1e6).toFixed(0)}M₫`:"—",col:"#c0392b",icon:"💰"},
        ].map(c=>(
          <div key={c.label} style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"14px 16px",boxShadow:"0 1px 4px rgba(0,80,160,0.07)"}}>
            <div style={{fontSize:"20px",marginBottom:"4px"}}>{c.icon}</div>
            <div style={{fontSize:"24px",fontWeight:"700",color:c.col,lineHeight:1}}>{c.val}</div>
            <div style={{fontSize:"10px",color:"#90a8c0",marginTop:"4px",letterSpacing:"0.05em"}}>{c.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px"}}>
        {/* PIC performance - only show in "all" view */}
        {reportPIC==="all"&&picStats.length>0&&(
          <div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"16px",gridColumn:"1/-1",boxShadow:"0 1px 4px rgba(0,80,160,0.07)"}}>
            <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",marginBottom:"14px"}}>👤 Hiệu suất theo PIC</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:"10px"}}>
              {picStats.map(p=>(
                <div key={p.pic} style={{background:"#f4f8fc",borderRadius:"10px",padding:"12px",textAlign:"center",border:"1px solid #dde6f0"}}>
                  <div style={{fontWeight:"700",color:"#1a6fba",fontSize:"13px",marginBottom:"6px"}}>{p.pic}</div>
                  <div style={{fontSize:"11px",color:"#6080a0",marginBottom:"2px"}}>📋 {p.total} leads</div>
                  <div style={{fontSize:"11px",color:"#c0392b",marginBottom:"2px"}}>🔥 {p.hot} hot</div>
                  <div style={{fontSize:"11px",color:"#1a7a45",marginBottom:"2px"}}>🏆 {p.win} win</div>
                  {p.rev>0&&<div style={{fontSize:"11px",color:"#b86e00",fontWeight:"600"}}>{(p.rev/1e6).toFixed(0)}M₫</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stage distribution */}
        <div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"16px",boxShadow:"0 1px 4px rgba(0,80,160,0.07)"}}>
          <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",marginBottom:"14px"}}>📋 Phân bổ theo stage</div>
          {STAGES.map(st=>{
            const cfg=STAGE_CFG[st];
            const cnt=monthDeals.filter(d=>d.stage===st).length;
            const max=Math.max(...STAGES.map(s=>monthDeals.filter(d=>d.stage===s).length),1);
            return(
              <div key={st} style={{marginBottom:"10px"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                  <span style={{fontSize:"12px",color:cfg.color,fontWeight:"600"}}>{cfg.icon} {st}</span>
                  <span style={{fontSize:"12px",color:"#6080a0",fontWeight:"600"}}>{cnt}</span>
                </div>
                <div style={{background:"#f0f4f8",borderRadius:"4px",height:"6px"}}>
                  <div style={{background:cfg.border,width:`${max>0?(cnt/max)*100:0}%`,height:"100%",borderRadius:"4px",transition:"width 0.5s"}}/>
                </div>
              </div>
            );
          })}
        </div>

        {/* Avg days */}
        <div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"16px",boxShadow:"0 1px 4px rgba(0,80,160,0.07)"}}>
          <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",marginBottom:"14px"}}>⏱ Avg ngày chuyển stage</div>
          {Object.entries(avgDays).map(([key,val])=>{
            const [from,to]=key.split("→");
            const fc=STAGE_CFG[from]||{};const tc=STAGE_CFG[to]||{};
            return(
              <div key={key} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px",background:"#f4f8fc",borderRadius:"8px",padding:"8px 10px"}}>
                <span style={{fontSize:"11px",color:fc.color,fontWeight:"600"}}>{fc.icon} {from}</span>
                <span style={{color:"#c0cfd8",fontSize:"12px"}}>→</span>
                <span style={{fontSize:"11px",color:tc.color,fontWeight:"600"}}>{tc.icon} {to}</span>
                <span style={{marginLeft:"auto",fontSize:"13px",fontWeight:"700",color:val!==null?"#1a6fba":"#c0cfd8"}}>{val!==null?`${val} ngày`:"—"}</span>
              </div>
            );
          })}
        </div>

        {/* Transition log */}
        <div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"12px",padding:"16px",gridColumn:"1/-1",boxShadow:"0 1px 4px rgba(0,80,160,0.07)"}}>
          <div style={{fontWeight:"700",color:"#1a2a3a",fontSize:"13px",marginBottom:"14px"}}>🔄 Lịch sử chuyển stage trong tháng</div>
          {movedThisMonth.length===0
            ?<div style={{color:"#c0cfd8",fontSize:"12px",textAlign:"center",padding:"20px 0"}}>Chưa có chuyển stage nào</div>
            :<div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {movedThisMonth.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((h,i)=>{
                const fc=STAGE_CFG[h.from]||{};const tc=STAGE_CFG[h.to]||{};
                return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:"10px",background:"#f4f8fc",borderRadius:"8px",padding:"8px 12px"}}>
                    <span style={{fontSize:"12px",fontWeight:"700",color:"#1a2a3a",minWidth:"110px"}}>{h.brand||"—"}</span>
                    {h.pic&&<span style={{fontSize:"10px",background:"#e8f3fc",color:"#1a6fba",borderRadius:"4px",padding:"1px 6px",fontWeight:"600"}}>{h.pic}</span>}
                    <span style={{fontSize:"11px",color:fc.color,fontWeight:"600"}}>{fc.icon} {h.from}</span>
                    <span style={{color:"#c0cfd8"}}>→</span>
                    <span style={{fontSize:"11px",color:tc.color,fontWeight:"600"}}>{tc.icon} {h.to}</span>
                    <span style={{marginLeft:"auto",fontSize:"11px",color:"#90a8c0"}}>{fmtDate(h.date)}</span>
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

// ── Shared UI ─────────────────────────────────────────────
function Btn({children,onClick,blue,disabled,style={}}){
  return(<button onClick={onClick} disabled={disabled} style={{background:blue?"linear-gradient(135deg,#1a6fba,#2196f3)":"#fff",border:blue?"none":"1px solid #c8ddf0",borderRadius:"8px",padding:"7px 13px",color:blue?"#fff":"#1a6fba",fontWeight:blue?"700":"500",fontSize:"12px",cursor:disabled?"default":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit",boxShadow:blue?"0 2px 6px rgba(26,111,186,0.25)":"none",...style}}>{children}</button>);
}
function Field({label,children,span}){
  return(<div style={span?{gridColumn:"1/-1"}:{}}><div style={{fontSize:"10px",color:"#90a8c0",fontWeight:"600",letterSpacing:"0.06em",marginBottom:"5px"}}>{label.toUpperCase()}</div>{children}</div>);
}
function Inp({value,onChange,placeholder,type="text",multiline}){
  const base={background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"8px 10px",color:"#1a2a3a",fontSize:"13px",width:"100%",outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  return multiline?<textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={2} style={{...base,resize:"vertical"}}/>:<input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={base}/>;
}
function Modal({children,onClose}){
  return(<div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,40,80,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:"12px",backdropFilter:"blur(4px)"}}><div style={{background:"#fff",border:"1px solid #dde6f0",borderRadius:"16px",padding:"24px",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 8px 40px rgba(0,80,160,0.15)"}}>{children}</div></div>);
}
function MiniBtn({onClick,children,danger,title}){
  return(<button onClick={e=>{e.stopPropagation();onClick();}} title={title} style={{background:"transparent",border:"none",borderRadius:"4px",width:"20px",height:"20px",color:danger?"#c0392b":"#90a8c0",cursor:"pointer",fontSize:"12px",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>{children}</button>);
}

// ── Deal Modal ────────────────────────────────────────────
function DealModal({deal,onSave,onClose}){
  const isNew=!deal.id;
  const [f,setF]=useState({brand:"",contact:"",phone:"",platform:[],stage:"Data Thô",pic:"",source:"",value:"",notes:[],...deal,notes:parseNotes(deal.notes)});
  const [newNote,setNewNote]=useState("");
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const togglePlatform=p=>s("platform",f.platform.includes(p)?f.platform.filter(x=>x!==p):[...f.platform,p]);

  const addNote=()=>{
    if(!newNote.trim())return;
    const entry={text:newNote.trim(),date:new Date().toISOString()};
    s("notes",[...f.notes,entry]);
    setNewNote("");
  };

  return(
    <Modal onClose={onClose}>
      <div style={{width:"500px",maxWidth:"92vw"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:"18px",color:"#1a6fba",marginBottom:"18px"}}>{isNew?"✦ Thêm Deal Mới":"✦ Chỉnh sửa Deal"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"13px"}}>
          <Field label="Tên Brand *" span><Inp value={f.brand} onChange={v=>s("brand",v)} placeholder="Ví dụ: Cafuné, Owen, BOHEE..."/></Field>
          <Field label="Người liên hệ"><Inp value={f.contact} onChange={v=>s("contact",v)} placeholder="Tên người phụ trách"/></Field>
          <Field label="Số điện thoại"><Inp value={f.phone} onChange={v=>s("phone",v)} placeholder="0901..."/></Field>

          {/* PIC */}
          <Field label="BD P.I.C" span>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {PICS.map(p=>{
                const active=f.pic===p;
                return(<button key={p} onClick={()=>s("pic",active?"":p)} style={{background:active?"#e8f3fc":"#f4f8fc",border:`1.5px solid ${active?"#90c0ef":"#dde6f0"}`,borderRadius:"8px",padding:"5px 12px",color:active?"#1a6fba":"#90a8c0",fontSize:"12px",fontWeight:active?"700":"400",cursor:"pointer",fontFamily:"inherit",transition:"all 0.12s"}}>{p}</button>);
              })}
            </div>
          </Field>

          {/* Stage */}
          <Field label="Giai đoạn Pipeline" span>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {STAGES.map(st=>{const cfg=STAGE_CFG[st];const active=f.stage===st;return(<button key={st} onClick={()=>s("stage",st)} style={{background:active?cfg.badge:"#f4f8fc",border:`1.5px solid ${active?cfg.border:"#dde6f0"}`,borderRadius:"8px",padding:"5px 12px",color:active?cfg.color:"#90a8c0",fontSize:"12px",fontWeight:active?"700":"400",cursor:"pointer",fontFamily:"inherit",transition:"all 0.12s"}}>{cfg.icon} {st}</button>);})}
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
                <optgroup key={group} label={`── ${group}`}>
                  {items.map(src=><option key={`${group}-${src}`} value={`${group}: ${src}`}>{src}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Giá trị dự kiến (VND)"><Inp value={f.value} onChange={v=>s("value",v)} placeholder="50000000" type="number"/></Field>

          {/* Notes log */}
          <Field label="Ghi chú" span>
            <div style={{display:"flex",gap:"6px",marginBottom:"8px"}}>
              <input value={newNote} onChange={e=>setNewNote(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addNote();}}} placeholder="Nhập ghi chú rồi nhấn Enter hoặc nút ➕..." style={{background:"#f4f8fc",border:"1px solid #c8ddf0",borderRadius:"8px",padding:"8px 10px",color:"#1a2a3a",fontSize:"13px",flex:1,outline:"none",fontFamily:"inherit"}}/>
              <button onClick={addNote} style={{background:"linear-gradient(135deg,#1a6fba,#2196f3)",border:"none",borderRadius:"8px",padding:"8px 14px",color:"#fff",fontWeight:"700",fontSize:"13px",cursor:"pointer",fontFamily:"inherit"}}>➕</button>
            </div>
            {f.notes.length>0&&(
              <div style={{background:"#f4f8fc",borderRadius:"10px",padding:"10px",maxHeight:"180px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"6px"}}>
                {[...f.notes].reverse().map((n,i)=>(
                  <div key={i} style={{background:"#fff",borderRadius:"8px",padding:"8px 10px",border:"1px solid #dde6f0",position:"relative"}}>
                    <div style={{fontSize:"9px",color:"#90a8c0",marginBottom:"3px"}}>🕐 {fmtDT(n.date)}</div>
                    <div style={{fontSize:"12px",color:"#1a2a3a",lineHeight:1.5}}>{n.text}</div>
                    <button onClick={()=>s("notes",f.notes.filter((_,idx)=>f.notes.length-1-i!==idx))} style={{position:"absolute",top:"6px",right:"6px",background:"transparent",border:"none",color:"#f0a898",cursor:"pointer",fontSize:"11px",fontFamily:"inherit"}}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {f.notes.length===0&&<div style={{fontSize:"11px",color:"#c0cfd8",textAlign:"center",padding:"12px 0"}}>Chưa có ghi chú nào</div>}
          </Field>
        </div>

        {!isNew&&f.createdAt&&<div style={{fontSize:"11px",color:"#a0b8d0",marginTop:"12px"}}>📅 Ngày tạo: {fmtDate(f.createdAt)} · Cập nhật: {fmtDate(f.updatedAt)}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",gap:"8px",marginTop:"16px"}}>
          <Btn onClick={onClose}>Huỷ</Btn>
          <Btn blue onClick={()=>{if(!f.brand.trim())return alert("Vui lòng nhập tên Brand!");onSave(f);}}>{isNew?"Tạo Deal":"Lưu thay đổi"}</Btn>
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
  return(
    <Modal onClose={onClose}>
      <div style={{width:"540px",maxWidth:"92vw"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:"18px",color:"#1a6fba",marginBottom:"14px"}}>⚙ Kết nối Google Sheets</div>
        <div style={{background:"#f0f7ff",border:"1px solid #c8ddf0",borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"11px",color:"#1a6fba",fontWeight:"600",marginBottom:"10px"}}>📋 Hướng dẫn setup:</div>
          {["Mở Google Sheets → Extensions → Apps Script","Xoá code cũ, paste code bên dưới vào","Deploy → New deployment → Web app","Execute as: Me  |  Who has access: Anyone → Deploy","Copy Deployment URL và paste vào ô bên dưới"].map((step,i)=>(
            <div key={i} style={{display:"flex",gap:"10px",marginBottom:"6px",alignItems:"flex-start"}}>
              <span style={{background:"#1a6fba",color:"#fff",borderRadius:"50%",width:"18px",height:"18px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:"700",flexShrink:0}}>{i+1}</span>
              <span style={{fontSize:"12px",color:"#2a4a7a",lineHeight:1.5}}>{step}</span>
            </div>
          ))}
        </div>
        <div style={{marginBottom:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
            <span style={{fontSize:"10px",color:"#90a8c0",fontWeight:"600",letterSpacing:"0.06em"}}>APPS SCRIPT CODE</span>
            <button onClick={copy} style={{background:copied?"#e6f8ee":"#f4f8fc",border:`1px solid ${copied?"#80d0a8":"#c8ddf0"}`,borderRadius:"6px",padding:"3px 10px",color:copied?"#1a7a45":"#1a6fba",fontSize:"11px",cursor:"pointer",fontFamily:"inherit"}}>{copied?"✓ Đã copy!":"📋 Copy code"}</button>
          </div>
          <pre style={{background:"#f4f8fc",border:"1px solid #dde6f0",borderRadius:"8px",padding:"12px",fontSize:"10px",color:"#6080a0",overflowX:"auto",maxHeight:"120px",overflowY:"auto",margin:0,lineHeight:1.6}}>{SCRIPT_CODE}</pre>
        </div>
        <Field label="Web App URL"><Inp value={inputUrl} onChange={setInputUrl} placeholder="https://script.google.com/macros/s/.../exec"/></Field>
        <div style={{display:"flex",justifyContent:"flex-end",gap:"8px",marginTop:"16px"}}>
          <Btn onClick={onClose}>Đóng</Btn>
          <Btn blue onClick={()=>onSave(inputUrl.trim())}>Lưu kết nối</Btn>
        </div>
      </div>
    </Modal>
  );
}
