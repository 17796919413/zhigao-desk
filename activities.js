// Legacy records keep their existing relationships; no filename-based migration.
export const LEGACY_ACTIVITY='legacy';
export const SHARED_ACTIVITY='*';
export const activityOf=record=>record?.activityId||LEGACY_ACTIVITY;
export function activitiesOf(project){
  return [{id:LEGACY_ACTIVITY,name:'原有活动'},...(project?.activities||[]).filter(a=>a.id!==LEGACY_ACTIVITY)];
}
export function selectedActivity(project){
  return activitiesOf(project).some(a=>a.id===project?.selectedActivity)?project.selectedActivity:LEGACY_ACTIVITY;
}
export function activityName(project,id=selectedActivity(project)){return activitiesOf(project).find(a=>a.id===id)?.name||'未知活动';}
export function belongsToActivity(record,id){return activityOf(record)===id;}
export function sourcesForActivity(records,id){return (records||[]).filter(r=>r.activityId===SHARED_ACTIVITY||activityOf(r)===id);}
export const activityRevision=(project,id=selectedActivity(project))=>project?.activityRevisions?.[id]??project?.date??'';
// Capture the destination before asynchronous parsing; selection is never a destination.
export function assertActivitySelection(project,projectId,activityId){
  if(project?.id!==projectId||selectedActivity(project)!==activityId)throw Object.assign(Error('品牌或活动已切换，请回到原活动后重试。'),{code:'ACTIVITY_MISMATCH'});
}
export function activityBasis(project,id=selectedActivity(project)){
  const p=projectForActivity(project,id);
  const clean=rows=>rows.filter(x=>x.active!==false&&x.enabled!==false).map(({history,...x})=>x);
  return {name:p.name,activityId:id,notes:p.notes,library:clean(p.library),rules:clean(p.rules)};
}
export function projectForActivity(project,id=selectedActivity(project)){
  if(!project)throw Object.assign(Error('请选择有效品牌项目。'),{code:'PROJECT_NOT_FOUND'});
  if(!activitiesOf(project).some(a=>a.id===id))throw Object.assign(Error('活动已不存在，请重新选择。'),{code:'ACTIVITY_NOT_FOUND'});
  return {...project,selectedActivity:id,activityId:id,activityName:activityName(project,id),date:activityRevision(project,id),
    notes:id===LEGACY_ACTIVITY?project.notes||'':activitiesOf(project).find(a=>a.id===id)?.notes||'',
    library:sourcesForActivity(project.library,id),rules:sourcesForActivity(project.rules,id)};
}
export function addActivity(project,name){
  name=String(name||'').trim();if(!name)throw Error('请填写活动名称。');
  if(activitiesOf(project).some(a=>a.name===name))throw Error('此品牌已有同名活动。');
  const activity={id:crypto.randomUUID(),name,created:new Date().toISOString(),notes:''};
  return {...project,activities:[...(project.activities||[]),activity],selectedActivity:activity.id};
}
export function validateScope(project,id){
  if(id!==SHARED_ACTIVITY&&!activitiesOf(project).some(a=>a.id===id))throw Error('请选择当前品牌的活动或品牌长期资料。');
  return id;
}
