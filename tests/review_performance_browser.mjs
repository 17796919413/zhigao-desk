// Synthetic PDFs only. Baseline modules are served from the unchanged Git HEAD.
export async function benchmark(prefix){
 const {parseLibraryFile}=await import(prefix+'/library-import.js');
 const {createReviewService}=await import(prefix+'/review-service.js');
 const pdf=await import(prefix+'/pdf.js');
 const buffer=await(await fetch('/__fixture/hundred-pages.pdf')).arrayBuffer();
 const parsed=await parseLibraryFile(new File([buffer],'synthetic-100.pdf',{type:'application/pdf'}));
 const {originalAsset,...library}=parsed;library.id='pdf';library.ingestion.assetKey='original';
 const project={id:'perf',name:'Synthetic performance fixture',status:'active',notes:'',rules:[],library:[library]};
 const task={id:'draft',projectId:'perf',fmt:'text',kind:'图文',stage:'初稿',platform:'其他',cells:[{id:'p',original:'Synthetic manuscript.',current:'Synthetic manuscript.'}],flow:{state:'review',round:1,feedback:[]}};
 const state={settings:{selected:'perf',projects:[project]},tasks:[task],batches:[]};let originalReads=0;
 const service=createReviewService({state:()=>state,getLibraryFile:async()=>{originalReads++;return structuredClone(originalAsset);},saveReviewProgress:async()=>{}});
 const brief=await service.zhigao_get_review_brief({docId:task.id}),args={docId:task.id,reviewToken:brief.reviewToken};
 let assets=[],cursor;do{const page=await service.zhigao_read_review_context({...args,section:'assets',cursor});assets.push(...page.items);cursor=page.nextCursor;}while(cursor);
 if(assets.length!==100)throw Error('Expected 100 full pages');
 pdf.clearPdfCache?.();const statsBefore={...pdf.pdfCacheStats};originalReads=0;
 const started=performance.now();let calls=0,images=0,first;
 for(let i=0;i<assets.length;){let items;
  if(service.zhigao_read_review_assets){const out=await service.zhigao_read_review_assets({...args,assetIds:assets.slice(i,i+4).map(x=>x.id)});items=out.items;i+=4;}
  else{items=[await service.zhigao_read_review_asset({...args,assetId:assets[i].id})];i++;}
  calls++;images+=items.length;
  for(const item of items){if(item.type!=='image'||!item.receipt||item.coverage!=='full'||!item.data.startsWith('iVBOR'))throw Error('Missing native full PNG/receipt');}
  first??=items[0];
 }
 const elapsedMs=Math.round(performance.now()-started),readCount=originalReads,delta={};for(const key of Object.keys(pdf.pdfCacheStats||{}))delta[key]=pdf.pdfCacheStats[key]-(statsBefore[key]||0);
 // A warm page request must reuse its image. Large fixtures are evicted by design.
 if(pdf.clearPdfCache){await service.zhigao_read_review_asset({...args,assetId:assets[0].id});const before=pdf.pdfCacheStats.imageHits;await service.zhigao_read_review_asset({...args,assetId:assets[0].id});if(pdf.pdfCacheStats.imageHits!==before+1)throw Error('Page image cache missed');}
 const image=document.createElement('img');image.id='pdf-preview';image.src='data:'+first.mimeType+';base64,'+first.data;image.style='position:fixed;inset:20px auto auto 20px;height:90vh;z-index:999999;background:white';document.body.append(image);await image.decode();
 return {pages:assets.length,images,calls,originalReads:readCount,elapsedMs,cache:delta};
}
