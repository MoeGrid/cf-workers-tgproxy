// 落地看板：展示接入信息与实例运行指标。
//
// 接入串由浏览器端拼装，不落在 HTML 源码里。
// 页面自身由 Worker 侧用 ?secret= 校验后才下发。

/** 插入内联 <script> 的字符串字面量：转义 < 防止提前闭合脚本标签。 */
const jsString = (v) => JSON.stringify(String(v)).replace(/</g, '\\u003c');

export function mkDashboard({ host, secret }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>边缘节点控制台</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background-color: #f0f2f5;
    color: #303133;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
    padding: 40px 16px;
  }
  .container { width: 100%; max-width: 560px; background: #fff; border: 1px solid #dcdfe6; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid #ebeef5; }
  .title { font-size: 19px; font-weight: 600; letter-spacing: 0.2px; }
  .subtitle { font-size: 11px; color: #a8abb2; letter-spacing: 1.6px; margin-top: 3px; }
  .badge-success { font-size: 12px; color: #67c23a; background: #f0f9eb; border: 1px solid #e1f3d8; padding: 4px 10px; border-radius: 20px; white-space: nowrap; }
  .content { padding: 20px 24px 24px; }
  .card-section { margin-bottom: 22px; }
  .section-label { font-size: 12px; font-weight: 600; color: #909399; letter-spacing: 0.6px; margin-bottom: 10px; }
  .panel { background: #fdfdfd; border: 1px solid #ebeef5; border-radius: 6px; padding: 16px; }
  .detail-row { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; font-size: 13px; }
  .detail-row + .detail-row { border-top: 1px dashed #f0f2f5; }
  .detail-label { color: #909399; flex: none; }
  .detail-value { color: #303133; word-break: break-all; text-align: right; font-family: Consolas, Monaco, monospace; }
  .btn-group { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
  .btn {
    flex: 1; min-width: 130px; padding: 9px 14px; font-size: 13px; border-radius: 4px;
    cursor: pointer; border: 1px solid transparent; transition: all 0.2s;
    text-decoration: none; display: inline-flex; align-items: center; justify-content: center; font-weight: 500;
    font-family: inherit;
  }
  .btn-primary { background-color: #409eff; color: #fff; border-color: #409eff; }
  .btn-primary:hover { background-color: #66b1ff; border-color: #66b1ff; }
  .btn-default { background-color: #fff; color: #606266; border-color: #dcdfe6; }
  .btn-default:hover { color: #409eff; border-color: #c6e2ff; background-color: #ecf5ff; }
  .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .metric-card { background: #fafafa; border: 1px solid #ebeef5; border-radius: 6px; padding: 13px 10px; text-align: center; }
  .metric-title { font-size: 12px; color: #909399; margin-bottom: 5px; }
  .metric-value { font-family: Consolas, Monaco, monospace; font-size: 17px; font-weight: 600; color: #303133; }
  .metric-unit { font-size: 12px; color: #909399; font-weight: normal; }
  .metric-sub { font-size: 11px; color: #c0c4cc; margin-top: 3px; }
  .footer { padding: 14px 24px 18px; border-top: 1px solid #f2f3f5; font-size: 11px; color: #c0c4cc; text-align: center; letter-spacing: 0.4px; }
  .toast {
    position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
    background: #303133; color: #fff; padding: 8px 16px; border-radius: 4px;
    font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none; z-index: 1000;
  }
  .toast.show { display: block; animation: fadeInOut 2s ease forwards; }
  @keyframes fadeInOut {
    0% { opacity: 0; transform: translate(-50%, -10px); }
    15% { opacity: 1; transform: translate(-50%, 0); }
    85% { opacity: 1; transform: translate(-50%, 0); }
    100% { opacity: 0; transform: translate(-50%, -10px); }
  }
  @media (max-width: 480px) {
    .metrics-grid { grid-template-columns: 1fr; }
    .detail-row { flex-direction: column; gap: 2px; }
    .detail-value { text-align: left; }
  }
</style>
</head>
<body>

<div id="toast" class="toast">复制成功</div>

<div class="container">
  <div class="header">
    <div>
      <div class="title">边缘节点控制台</div>
      <div class="subtitle">EDGE RELAY CONSOLE</div>
    </div>
    <div class="badge-success">● 服务就绪</div>
  </div>

  <div class="content">
    <div class="card-section">
      <div class="section-label">接入信息</div>
      <div class="panel">
        <div class="detail-row">
          <span class="detail-label">服务域名</span>
          <span class="detail-value">${host}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">传输协议</span>
          <span class="detail-value">HTTPS / WebSocket</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">访问密钥</span>
          <span class="detail-value">${secret}</span>
        </div>
        <div class="btn-group">
          <button class="btn btn-primary" onclick="copyLink()">复制接入链接</button>
          <button class="btn btn-default" onclick="openLink()">直接打开</button>
        </div>
      </div>
    </div>

    <div class="card-section">
      <div class="section-label">运行状态</div>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-title">当前在线连接</div>
          <div class="metric-value" id="val-online" style="color: #67c23a;">0 <span class="metric-unit">路</span></div>
          <div class="metric-sub">实时并发</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">累计吞吐</div>
          <div class="metric-value" id="val-traffic" style="color: #409eff;">0.00 B</div>
          <div class="metric-sub">双向总传输量</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">累计会话</div>
          <div class="metric-value" id="val-sessions">0 <span class="metric-unit">次</span></div>
          <div class="metric-sub">总接入次数</div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">EDGE RELAY · 仅提供 WebSocket 中继能力</div>
</div>

<script>
var HOST = ${jsString(host)};
var SECRET = ${jsString(secret)};
var STATS_URL = '/api/stats?secret=' + encodeURIComponent(SECRET);

function buildLink() {
  return 't' + 'g://webproxy?server=' + encodeURIComponent(HOST) + '&secret=' + encodeURIComponent(SECRET);
}
function copyLink() {
  copyText(buildLink(), '接入链接已复制');
}
function openLink() {
  location.href = buildLink();
}
function copyText(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { showToast(msg || '复制成功'); }).catch(function () { fallbackCopy(text, msg); });
  } else { fallbackCopy(text, msg); }
}
function fallbackCopy(text, msg) {
  var input = document.createElement('input');
  input.setAttribute('value', text);
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
  showToast(msg || '复制成功');
}
function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function () { toast.classList.remove('show'); }, 2000);
}
function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}
function setHtml(id, value) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = value;
}
function updateMetrics() {
  fetch(STATS_URL)
    .then(function (res) { return res.json(); })
    .then(function (data) {
      setHtml('val-online', data.active_connections + ' <span class="metric-unit">路</span>');
      setText('val-traffic', data.total_traffic);
      setHtml('val-sessions', data.total_sessions + ' <span class="metric-unit">次</span>');
    }).catch(function () {});
}
updateMetrics();
setInterval(updateMetrics, 3000);
</script>
</body>
</html>`;
}
