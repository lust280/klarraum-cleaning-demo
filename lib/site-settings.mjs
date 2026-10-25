import {HttpError} from './validation.mjs';
const fail=()=>{throw new HttpError(400,'Bitte Website-Einstellungen prüfen. Mindestens eine Leistung muss aktiv bleiben.');};
function text(value,max,required=false){
 if(typeof value!=='string')fail();const cleaned=value.trim();
 if(cleaned.length>max || (required&&!cleaned) || /[\x00-\x1f\x7f]/.test(cleaned))fail();return cleaned;
}
export function checkedSite(value){
 if(!value || typeof value!=='object')fail();
 const c=value.company,h=value.hero;if(!c||!h)fail();
 const company={name:text(c.name,80,true),phone:text(c.phone,40),email:text(c.email,254),address:text(c.address,200),hours:text(c.hours,160),area:text(c.area,100,true),theme:c.theme};
 if(!['forest','navy','clay'].includes(company.theme))fail();
 if(company.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email))fail();
 if(company.phone && (!/^[+\d\s()/.\-]+$/.test(company.phone)||company.phone.replace(/\D/g,'').length<7))fail();
 const hero={title:text(h.title,100,true),subtitle:text(h.subtitle,100,true),description:text(h.description,600,true)};
 const services={};
 for(const key of ['home','office','deep']){
  const item=value.services?.[key];if(!item || typeof item.enabled!=='boolean')fail();
  services[key]={title:text(item.title,80,true),description:text(item.description,400,true),enabled:item.enabled};
 }
 if(!Object.values(services).some(item=>item.enabled) || typeof value.windowsEnabled!=='boolean')fail();
 return {company,hero,services,windowsEnabled:value.windowsEnabled};
}
export function checkedNote(value){
 if(typeof value!=='string'||value.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw new HttpError(400,'Notiz: maximal 2000 Zeichen.');
 return value.trim();
}
