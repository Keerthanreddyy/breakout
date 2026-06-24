import { useState, useCallback, useEffect } from 'react'

const API = ''

const fmtNum = n => {
  if (!n && n !== 0) return '—'
  if (n >= 1e7) return (n / 1e7).toFixed(2) + ' Cr'
  if (n >= 1e5) return (n / 1e5).toFixed(2) + ' L'
  return n.toLocaleString('en-IN')
}

const CONDITIONS_META = [
  { key: 'c1_volSurge',  label: '① Vol>Avg×3' },
  { key: 'c2_minClose',  label: '② >₹30'      },
  { key: 'c3_pctChange', label: '③ ≥6.5%'     },
  { key: 'c4_avgVol',    label: '④ AvgVol≥25K' },
  { key: 'c5_minVol',    label: '⑤ Vol>50K'   },
]

const S = {
  app:       { minHeight:'100vh', background:'#0d0f14', color:'#e2e6f0', fontFamily:"'IBM Plex Mono','Courier New',monospace", padding:'20px 16px 60px' },
  header:    { display:'flex', alignItems:'baseline', gap:14, borderBottom:'1px solid #1f2330', paddingBottom:16, marginBottom:24 },
  h1:        { fontSize:'1.1rem', fontWeight:700, color:'#00e5a0', letterSpacing:'.05em' },
  subtitle:  { fontSize:'.72rem', color:'#5a6070' },
  dot:       { width:8, height:8, borderRadius:'50%', background:'#00e5a0', display:'inline-block', marginRight:8, animation:'pulse 1.6s infinite' },
  panel:     { background:'#13161e', border:'1px solid #1f2330', borderRadius:6, padding:'14px 18px', marginBottom:16 },
  label:     { fontSize:'.6rem', letterSpacing:'.12em', textTransform:'uppercase', color:'#5a6070', marginBottom:10 },
  condRow:   { display:'flex', gap:20, flexWrap:'wrap', fontSize:'.78rem' },
  condItem:  { color:'#00e5a0', borderLeft:'2px solid #00e5a0', paddingLeft:8 },
  controls:  { display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' },
  input:     { background:'#13161e', border:'1px solid #1f2330', borderRadius:4, color:'#e2e6f0', fontFamily:'inherit', fontSize:'.8rem', padding:'7px 12px', outline:'none', flex:1, minWidth:220 },
  btnGreen:  { background:'#00e5a0', color:'#000', fontFamily:'inherit', fontWeight:700, fontSize:'.8rem', border:'none', borderRadius:4, padding:'8px 18px', cursor:'pointer' },
  btnOutline:{ background:'transparent', color:'#5a6070', border:'1px solid #1f2330', fontFamily:'inherit', fontSize:'.8rem', borderRadius:4, padding:'8px 14px', cursor:'pointer' },
  summary:   { display:'flex', gap:20, marginBottom:16, flexWrap:'wrap', fontSize:'.75rem', color:'#5a6070', alignItems:'flex-end' },
  stat:      { display:'flex', flexDirection:'column', gap:2 },
  statVal:   (c) => ({ fontSize:'1.1rem', fontWeight:700, color:c||'#e2e6f0' }),
  progressBar:  { height:3, background:'#1f2330', borderRadius:2, marginBottom:16, overflow:'hidden' },
  progressFill: (p) => ({ height:'100%', background:'#00e5a0', width:p+'%', transition:'width .3s' }),
  tableWrap: { overflowX:'auto', border:'1px solid #1f2330', borderRadius:6 },
  table:     { width:'100%', borderCollapse:'collapse', fontSize:'.78rem' },
  th:        { background:'#13161e', color:'#5a6070', fontSize:'.62rem', letterSpacing:'.1em', textTransform:'uppercase', padding:'10px 12px', textAlign:'left', whiteSpace:'nowrap', borderBottom:'1px solid #1f2330', cursor:'pointer', userSelect:'none' },
  td:        { padding:'9px 12px', whiteSpace:'nowrap', borderBottom:'1px solid #1f2330' },
  badge:     (p) => ({ display:'inline-block', fontSize:'.68rem', padding:'2px 7px', borderRadius:3, background:p?'rgba(0,229,160,.12)':'rgba(255,69,96,.12)', color:p?'#00e5a0':'#ff4560' }),
  cc:        (ok) => ({ display:'inline-block', fontSize:'.62rem', padding:'1px 5px', borderRadius:2, marginRight:3, marginBottom:2, background:ok?'rgba(0,229,160,.15)':'rgba(255,69,96,.12)', color:ok?'#00e5a0':'#ff4560' }),
  errBox:    { background:'rgba(255,69,96,.08)', border:'1px solid rgba(255,69,96,.3)', borderRadius:6, padding:'12px 16px', marginBottom:16, color:'#ff6b7a', fontSize:'.78rem' },
  emptyBox:  { textAlign:'center', padding:'52px 0', color:'#5a6070', fontSize:'.85rem' },
  chip:      { background:'rgba(61,139,255,.12)', color:'#3d8bff', fontSize:'.68rem', padding:'2px 8px', borderRadius:3, display:'inline-block' },
}

export default function App() {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [meta, setMeta]         = useState(null)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')
  const [customSyms, setCustom] = useState('')
  const [filter, setFilter]     = useState('all')
  const [sortCol, setSortCol]   = useState('pctChange')
  const [sortDir, setSortDir]   = useState(-1)
  const [status, setStatus]     = useState(null)

  useEffect(() => {
    fetch(`${API}/api/status`)
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {})
  }, [])

  const runScan = useCallback(async () => {
    setLoading(true); setError(''); setRows([]); setMeta(null); setProgress(5)

    let estSeconds = status?.estimatedScanSeconds || 60
    if (customSyms.trim()) {
      const cnt = customSyms.split(/[\s,]+/).filter(Boolean).length
      estSeconds = Math.ceil((cnt / 5) * 0.25)
    }

    try {
      let url  = `${API}/api/scan`
      let opts = {}
      if (customSyms.trim()) {
        const syms = customSyms.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
        url  = `${API}/api/scan/custom`
        opts = { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ symbols:syms }) }
      }

      const tickMs = (estSeconds * 1000) / 85
      const timer  = setInterval(() => setProgress(p => Math.min(p + 1, 90)), tickMs)
      const res    = await fetch(url, opts)
      clearInterval(timer)

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setProgress(100)
      setRows(data.results || [])
      setMeta({ total:data.total, passed:data.passed, scannedAt:data.scannedAt, errors:data.errors })
    } catch (e) {
      setError(`Scan failed: ${e.message}. Make sure backend is running → node backend/server.js`)
    } finally {
      setLoading(false)
      setTimeout(() => setProgress(0), 600)
    }
  }, [customSyms, status])

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d * -1)
    else { setSortCol(col); setSortDir(-1) }
  }

  const getVal = (row, col) => {
    if (col === 'symbol')    return row.symbol
    if (col === 'close')     return row.close
    if (col === 'pctChange') return row.pctChange
    if (col === 'volume')    return row.volume
    if (col === 'avgVol50')  return row.avgVol50
    if (col === 'volRatio')  return row.volRatio
    if (col === 'pass')      return row.pass ? 1 : 0
    return 0
  }

  const visible = rows
    .filter(r => {
      const s = search.trim().toLowerCase()
      if (s && !r.symbol.toLowerCase().includes(s) && !r.name?.toLowerCase().includes(s)) return false
      if (filter === 'pass' && !r.pass) return false
      if (filter === 'fail' &&  r.pass) return false
      return true
    })
    .sort((a, b) => {
      const va = getVal(a, sortCol), vb = getVal(b, sortCol)
      return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir
    })

  const thP = col => ({
    style: { ...S.th, color: sortCol === col ? '#e2e6f0' : '#5a6070' },
    onClick: () => handleSort(col),
  })
  const arr = col => sortCol === col ? (sortDir === 1 ? ' ↑' : ' ↓') : ''

  const estTime = status
    ? `~${status.estimatedScanSeconds}s cold · ~${Math.ceil(status.estimatedScanSeconds * 0.05)}s cached`
    : ''

  return (
    <div style={S.app}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      <header style={S.header}>
        <h1 style={S.h1}><span style={S.dot}/>BREAKOUT SCREENER</h1>
        <span style={S.subtitle}>NSE · Cash Segment · Yahoo Finance</span>
        {status && (
          <span style={{ ...S.chip, marginLeft:'auto' }}>
            {status.totalSymbols.toLocaleString()} stocks · {estTime}
          </span>
        )}
      </header>

      {/* Conditions */}
      <div style={S.panel}>
        <div style={S.label}>Active Conditions — ALL must pass</div>
        <div style={S.condRow}>
          <span style={S.condItem}>① Vol &gt; SMA(Vol,50) × 3</span>
          <span style={S.condItem}>② Close &gt; ₹30</span>
          <span style={S.condItem}>③ %Chg ≥ 6.5%</span>
          <span style={S.condItem}>④ AvgVol50 ≥ 25K</span>
          <span style={S.condItem}>⑤ Vol &gt; 50K</span>
        </div>
      </div>

      {/* Custom symbols */}
      <div style={S.panel}>
        <div style={S.label}>Custom Scan (optional — blank = full NSE list)</div>
        <textarea
          rows={2}
          placeholder="RELIANCE, INFY, ZOMATO, ...  (comma or space separated)"
          value={customSyms}
          onChange={e => setCustom(e.target.value)}
          style={{ ...S.input, width:'100%', resize:'vertical', minHeight:52 }}
        />
      </div>

      {/* Controls */}
      <div style={S.controls}>
        <input style={S.input} placeholder="Filter by symbol or name…" value={search} onChange={e => setSearch(e.target.value)}/>
        {['all','pass','fail'].map(f => (
          <button key={f} style={filter===f ? S.btnGreen : S.btnOutline} onClick={() => setFilter(f)}>
            {f.toUpperCase()}
          </button>
        ))}
        <button style={{ ...S.btnGreen, marginLeft:'auto', opacity:loading?.5:1 }} onClick={runScan} disabled={loading}>
          {loading ? '⏳ Scanning…' : '▶ Run Scan'}
        </button>
        {rows.length > 0 && (
          <button style={S.btnOutline} onClick={() => { setRows([]); setMeta(null) }}>Clear</button>
        )}
      </div>

      {/* Progress */}
      {loading && <div style={S.progressBar}><div style={S.progressFill(progress)}/></div>}
      {loading && (
        <div style={{ fontSize:'.72rem', color:'#5a6070', marginBottom:12, textAlign:'center' }}>
          Scanning… {progress}% · fetching {status?.totalSymbols} stocks in parallel batches
        </div>
      )}

      {/* Error */}
      {error && <div style={S.errBox}>⚠ {error}</div>}

      {/* Summary */}
      {meta && (
        <div style={S.summary}>
          <div style={S.stat}><span style={S.statVal('#00e5a0')}>{meta.passed}</span>PASS</div>
          <div style={S.stat}><span style={S.statVal('#ff4560')}>{meta.total - meta.passed}</span>FAIL</div>
          <div style={S.stat}><span style={S.statVal()}>{meta.total}</span>SCANNED</div>
          <div style={S.stat}><span style={S.statVal()}>{visible.length}</span>SHOWING</div>
          {meta.errors?.length > 0 && (
            <div style={S.stat}><span style={S.statVal('#ff6b35')}>{meta.errors.length}</span>ERRORS</div>
          )}
          <div style={{ ...S.stat, marginLeft:'auto' }}>
            <span style={{ fontSize:'.68rem', color:'#5a6070' }}>{new Date(meta.scannedAt).toLocaleTimeString('en-IN')}</span>
            SCANNED AT
          </div>
        </div>
      )}

      {/* Table */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th {...thP('symbol')}>Symbol{arr('symbol')}</th>
              <th {...thP('close')}>Close (₹){arr('close')}</th>
              <th {...thP('pctChange')}>% Chg{arr('pctChange')}</th>
              <th {...thP('volume')}>Volume{arr('volume')}</th>
              <th {...thP('avgVol50')}>Avg Vol 50D{arr('avgVol50')}</th>
              <th {...thP('volRatio')}>Vol Ratio{arr('volRatio')}</th>
              <th style={S.th}>Conditions</th>
              <th {...thP('pass')}>Status{arr('pass')}</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && !loading && (
              <tr><td colSpan={8}>
                <div style={S.emptyBox}>
                  {meta
                    ? '🔍 No stocks match filter'
                    : `▶ Run Scan to screen ${status ? status.totalSymbols.toLocaleString() : 'all'} NSE stocks live`
                  }
                </div>
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={8}>
                <div style={S.emptyBox}>
                  ⏳ Fetching {status?.totalSymbols} stocks — batching 5 at a time…
                </div>
              </td></tr>
            )}
            {visible.map(row => (
              <tr key={row.symbol}>
                <td style={{ ...S.td, color:'#3d8bff', fontWeight:700 }}>
                  {row.symbol}
                  <div style={{ fontSize:'.6rem', color:'#5a6070', marginTop:1 }}>{row.name}</div>
                </td>
                <td style={S.td}>₹{row.close?.toFixed(2)}</td>
                <td style={{ ...S.td, color:row.pctChange>=0?'#00e5a0':'#ff4560' }}>
                  {row.pctChange>=0?'+':''}{row.pctChange?.toFixed(2)}%
                </td>
                <td style={S.td}>{fmtNum(row.volume)}</td>
                <td style={S.td}>{fmtNum(row.avgVol50)}</td>
                <td style={{ ...S.td, color:row.volRatio>=3?'#00e5a0':'#e2e6f0' }}>×{row.volRatio?.toFixed(2)}</td>
                <td style={S.td}>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:2 }}>
                    {CONDITIONS_META.map(c => (
                      <span key={c.key} style={S.cc(row.conditions?.[c.key])}>{c.label}</span>
                    ))}
                  </div>
                </td>
                <td style={S.td}>
                  <span style={S.badge(row.pass)}>{row.pass?'✓ PASS':'✗ FAIL'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop:28, fontSize:'.68rem', color:'#5a6070', textAlign:'center', lineHeight:1.9 }}>
        Yahoo Finance · 5-min cache · Not investment advice<br/>
        <code style={{ color:'#3d8bff' }}>node backend/server.js</code> · <code style={{ color:'#3d8bff' }}>cd frontend && npm run dev</code>
      </div>
    </div>
  )
}
