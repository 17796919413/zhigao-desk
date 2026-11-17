// Values are reviewable but kept read-only so exporting cannot change formulas,
// number formats, or typed values into inline strings.
const builtin={0:'General',1:'0',2:'0.00',3:'#,##0',4:'#,##0.00',9:'0%',10:'0.00%',11:'0.00E+00',14:'mm-dd-yy',15:'d-mmm-yy',16:'d-mmm',17:'mmm-yy',18:'h:mm AM/PM',19:'h:mm:ss AM/PM',20:'h:mm',21:'h:mm:ss',22:'m/d/yy h:mm',49:'@'};
export function numericDisplay(raw,formatId,custom,date1904=false){
 const n=Number(raw),format=custom??builtin[formatId];
 if(!Number.isFinite(n)||!String(raw).trim())return {text:String(raw),blocker:'数值无效'};
 if(format==='General'||format==='@')return {text:String(raw)};
 if(format&&/^[#0,]+(?:\.0+)?%?$/.test(format)){const decimals=(format.match(/\.(0+)/)?.[1]||'').length;return {text:(n*(format.endsWith('%')?100:1)).toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:Math.min(decimals,20),useGrouping:format.includes(',')})+(format.endsWith('%')?'%':'')};}
 if(format==='0.00E+00')return {text:n.toExponential(2).toUpperCase().replace(/E([+-])(\d)$/,'E$10$2')};
 // Plain calendar/time formats are interpreted in the workbook date system.
 // Only calendar separators may be unwrapped: in numeric formats, escaped dots
 // are literal output and must not become decimal placeholders.
 const calendarFormat=format?.replace(/\\([/:.\- ])/g,'$1').replace(/"([/:.\- ]+)"/g,'$1');
 if(calendarFormat&&/^[ymdhs/:.\-\s]+(?:AM\/PM)?$/i.test(calendarFormat)&&/[ydhs]/i.test(calendarFormat)){
  const format=calendarFormat;
  if(n<0||n>2958465||!date1904&&Math.floor(n)===60)return {text:String(raw),blocker:'日期序列无法确认显示值'};
  const day=Math.floor(n),ms=Math.round((n-day)*86400000),d=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:31)+(day-(!date1904&&day>=60?1:0))*86400000+ms);
  const pad=(v,l=2)=>String(v).padStart(l,'0'),month=d.getUTCMonth()+1,hour=d.getUTCHours();
  const text=format.replace(/AM\/PM|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s/gi,(token,offset)=>{
   const t=token.toLowerCase();if(t==='am/pm')return hour>=12?'PM':'AM';if(t[0]==='y')return t==='yyyy'?String(d.getUTCFullYear()):pad(d.getUTCFullYear()%100);
   if(t[0]==='d')return t.length>=3?d.toLocaleDateString('en-US',{weekday:t.length===3?'short':'long',timeZone:'UTC'}):t==='dd'?pad(d.getUTCDate()):String(d.getUTCDate());
   if(t[0]==='m'){const time=/h[^yd]*$/i.test(format.slice(0,offset))||/^:s/i.test(format.slice(offset+token.length));if(time)return t==='mm'?pad(d.getUTCMinutes()):String(d.getUTCMinutes());return t.length>=3?d.toLocaleDateString('en-US',{month:t.length===3?'short':'long',timeZone:'UTC'}):t==='mm'?pad(month):String(month);}
   const v=t[0]==='s'?d.getUTCSeconds():/AM\/PM/i.test(format)?hour%12||12:hour;return t.length===2?pad(v):String(v);
  });return {text};
 }
 return {text:String(raw),blocker:'尚不能确认数字格式 '+(format??formatId)+' 的显示值'};
}
