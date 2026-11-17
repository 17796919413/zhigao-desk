// Transport presence and a successful project-bound tool call are separate facts.
export function verifiedConnection(agent, projectId) {
  const v=agent.verification;
  return agent.state==='online' && !!projectId && v?.projectId===projectId && agent.clients.includes(v.client);
}

export function connectionLabel(agent, projectId) {
  if(verifiedConnection(agent,projectId))return ['AI 可用','on'];
  return ({off:['未连接 AI',''],connecting:['正在连接…','amber'],reconnecting:['正在恢复连接…','amber'],offline:['暂时无法连接','red'],waiting:['网页已连接 · 等待 AI','amber'],online:['客户端在线 · 待验证','amber'],'other-tab':['其他页面已连接','amber']})[agent.state]||['未连接 AI',''];
}

export function connectionPrompt(href, project) {
  const url=new URL('./',href);
  // Do not copy transient query parameters, fragments or URL credentials.
  url.username='';url.password='';
  return `帮我连接这个知稿工作台：${url.href}\n当前品牌：${JSON.stringify(project.name||'')}；项目 ID：${JSON.stringify(project.id||'')}。\n请读取该网址下的 AGENT_SETUP.md 和 setup-manifest.json，检查当前环境，复用已有配置，只接入我正在使用的 AI 客户端。需要本人登录、允许浏览器访问或选择归档目录时，给我准确入口。接入后真实调用 zhigao_setup_status 和 zhigao_status({project:${JSON.stringify(project.id||'')}})，确认当前项目一致，再分别报告 AI、飞书和归档状态。`;
}
