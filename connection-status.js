// Connection consent belongs to a live AI session, not to a brand.
export function verifiedConnection(agent, projectId) {
  const v=agent.verification;
  return agent.state==='online' && !!v && agent.clients.includes(v.client);
}

export function connectionLabel(agent, projectId) {
  if(verifiedConnection(agent,projectId))return ['AI 已连接','on'];
  if(agent.state==='offline')return [agent.lastConfirmedAt?'连接已中断':'网页未连到连接器','red'];
  if(agent.state==='waiting'&&agent.lastConfirmedAt)return ['AI 会话未连接','amber'];
  return ({off:['未连接 AI',''],connecting:['正在连接…','amber'],reconnecting:['正在恢复连接…','amber'],offline:['暂时无法连接','red'],waiting:['网页已连接 · 等待 AI','amber'],online:['等待接入','amber'],'other-tab':['其他页面已连接','amber']})[agent.state]||['未连接 AI',''];
}

// Identifies this loaded page, not a credential or a connection claim.
export const invitationPage=crypto.randomUUID();
export function connectionPrompt(href, project) {
  const url=new URL('./',href);
  // Do not copy transient query parameters, fragments or URL credentials.
  url.username='';url.password='';
  return `帮我连接知稿：${url.href}（${JSON.stringify(project.name||'')}）。\n请在本对话实际调用 zhigao_status({project:${JSON.stringify(project.id||'')},invitationPage:"${invitationPage}"})，不沿用其他对话的回复。必须返回 connected:true，且项目 ID、页面编号均与原网页一致；缺失、不一致或超时不能报成功。不另开页面。仅当工具不可用时，按该网址的 AGENT_SETUP.md 和 setup-manifest.json 复用或配置当前客户端。成功只回复「已连接知稿，可以开始审稿。」遇阻只说原因和一个必要动作。不检查飞书或归档。`;
}
