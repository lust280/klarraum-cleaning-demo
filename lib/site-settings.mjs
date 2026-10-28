import {HttpError} from './validation.mjs';
const fail=()=>{throw new HttpError(400,'Bitte Website-Einstellungen prüfen. Mindestens eine Leistung muss aktiv bleiben.');};
function text(value,max,required=false){
 if(typeof value!=='string')fail();const cleaned=value.trim();
 if(cleaned.length>max || (required&&!cleaned) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(cleaned))fail();return cleaned;
}
export function checkedSite(value){
 if(!value || typeof value!=='object')fail();
 const c=value.company,h=value.hero;if(!c||!h)fail();
 const company={name:text(c.name,80,true),phone:text(c.phone,40),email:text(c.email,254),address:text(c.address,200),hours:text(c.hours,160),area:text(c.area,100,true),theme:c.theme};
 if(!['forest','navy','clay','dark','light'].includes(company.theme))fail();
 if(company.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email))fail();
 if(company.phone && (!/^[+\d\s()/.\-]+$/.test(company.phone)||company.phone.replace(/\D/g,'').length<7))fail();
 const hero={title:text(h.title,100,true),subtitle:text(h.subtitle,100,true),description:text(h.description,600,true)};
 const services={};
 for(const key of ['home','office','deep']){
  const item=value.services?.[key];if(!item || typeof item.enabled!=='boolean')fail();
  services[key]={title:text(item.title,80,true),description:text(item.description,400,true),enabled:item.enabled};
 }
 if(!Object.values(services).some(item=>item.enabled) || typeof value.windowsEnabled!=='boolean')fail();
 const requestedBooking=value.booking??{};
 const booking={enabled:requestedBooking.enabled??true,dateEnabled:requestedBooking.dateEnabled??true,timeEnabled:requestedBooking.timeEnabled??true};
 if(!Object.values(booking).every(item=>typeof item==='boolean'))fail();
 const source=value.media??{logo:null,hero:null,gallery:[]};
 const id=value=>value===null?null:(typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)?value:fail());
 if(!Array.isArray(source.gallery)||source.gallery.length>8)fail();
 const media={logo:id(source.logo),hero:id(source.hero),gallery:source.gallery.map(item=>({id:id(item?.id),caption:text(item?.caption,160,true)}))};
 if(media.gallery.some(item=>!item.id)||new Set(media.gallery.map(item=>item.id)).size!==media.gallery.length)fail();
 if(!Array.isArray(value.testimonials??[])||(value.testimonials??[]).length>3)fail();
 const testimonials=(value.testimonials??[]).map(item=>({name:text(item?.name,80,true),text:text(item?.text,600,true)}));
 return {company,hero,services,windowsEnabled:value.windowsEnabled,tipEnabled:value.tipEnabled??true,booking,media,testimonials};
}
export function referencedMedia(content){return [...new Set([content.media?.logo,content.media?.hero,...(content.media?.gallery||[]).map(item=>item.id)].filter(Boolean))];}
export function checkedNote(value){
 if(typeof value!=='string'||value.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw new HttpError(400,'Notiz: maximal 2000 Zeichen.');
 return value.trim();
}
