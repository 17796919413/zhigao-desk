import fs from 'node:fs/promises';
import path from 'node:path';
const missing=e=>{if(e.code==='ENOENT')e.name='NotFoundError';return e;};
export function localDirectory(root,control={}){
 return {kind:'directory',name:path.basename(root),root,
  async queryPermission(){return control.denied?'denied':'granted';},
  async getDirectoryHandle(name,{create=false}={}){const p=path.join(root,name);try{if(create)await fs.mkdir(p);else await fs.access(p);}catch(e){if(e.code!=='EEXIST')throw missing(e);}return localDirectory(p,control);},
  async getFileHandle(name,{create=false}={}){
   const p=path.join(root,name);try{await fs.access(p);}catch(e){if(!create)throw missing(e);await fs.writeFile(p,'');if(control.created)await control.created(name);}
   return {kind:'file',name,async getFile(){const bytes=await fs.readFile(p),stat=await fs.stat(p);return new File([bytes],name,{lastModified:Math.round(stat.mtimeMs)});},
    async createWritable(){if(control.denied)throw Object.assign(Error('permission revoked'),{name:'NotAllowedError'});let data;
     return {async write(value){data=value instanceof Blob?Buffer.from(await value.arrayBuffer()):Buffer.from(value);if(control.write)await control.write(name,data);},async close(){if(control.close)await control.close(name,data);const temp=p+'.'+crypto.randomUUID()+'.test-staging';await fs.writeFile(temp,data);await fs.rename(temp,p);},async abort(){}};
    }};
  },
  async removeEntry(name){if(control.remove)await control.remove(name);try{await fs.unlink(path.join(root,name));}catch(e){throw missing(e);}},
  async *entries(){const names=await fs.readdir(root);if(control.listed)await control.listed(root,names);for(const name of names){if(name.endsWith('.test-staging'))continue;const p=path.join(root,name),s=await fs.stat(p);yield [name,s.isDirectory()?localDirectory(p,control):{kind:'file',name}];}}
 };
}
