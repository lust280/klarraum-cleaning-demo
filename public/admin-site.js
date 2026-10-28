import {t as translateUI} from './i18n.js';
import {applySiteMedia} from './site.js';
import {renderMediaEditor,currentMedia,currentTestimonials,mediaBusy} from './admin-media.js';
let request,version=0,dirty=false;
const form=document.querySelector('#site-form'),status=document.querySelector('#site-status');
const companySpecs=[['name',translateUI('Markenname'),80],['phone',translateUI('Öffentliche Telefonnummer'),40],['email',translateUI('Öffentliche E-Mail'),254],['address',translateUI('Öffentliche Adresse'),200],['hours',translateUI('Erreichbarkeit / Öffnungszeiten'),160],['area',translateUI('Region / Einsatzgebiet (Anzeige)'),100]];
function field(name,label,value,max,multiline=false){
 const wrapper=document.createElement('label');wrapper.append(document.createTextNode(label));
 const input=document.createElement(multiline?'textarea':'input');input.name=name;input.value=value;input.maxLength=max;
 if(multiline)input.rows=3;
 wrapper.append(input);return wrapper;
}
function render(content){
 applySiteMedia(content);
 document.querySelectorAll('[data-company]').forEach(node=>node.textContent=content.company.name);
 document.title=content.company.name+' · Verwaltung';
 const company=document.querySelector('#company-fields');company.replaceChildren(...companySpecs.map(([key,label,max])=>field('company_'+key,label,content.company[key],max)));
 const themeLabel=document.createElement('label');themeLabel.textContent=translateUI('Farbwelt');const theme=document.createElement('select');theme.name='company_theme';
 for(const [value,label] of [['dark',translateUI('Dark')],['light',translateUI('Light')]]){const option=document.createElement('option');option.value=value;option.textContent=label;theme.append(option);}theme.value=['dark','light'].includes(content.company.theme)?content.company.theme:'dark';themeLabel.append(theme);company.append(themeLabel);
 document.querySelector('#hero-fields').replaceChildren(field('hero_title',translateUI('Hauptüberschrift'),content.hero.title,100),field('hero_subtitle',translateUI('Zweite Überschrift'),content.hero.subtitle,100),field('hero_description',translateUI('Einleitung'),content.hero.description,600,true));
 const services=document.querySelector('#service-fields');services.replaceChildren();
 for(const [key,service] of Object.entries(content.services)){
  const section=document.createElement('fieldset');section.className='service-editor';const legend=document.createElement('legend');legend.textContent={home:translateUI('Wohnung / Haus'),office:translateUI('Büro / Gewerbe'),deep:translateUI('Grundreinigung')}[key];section.append(legend);
  const label=document.createElement('label');label.className='checkbox';const input=document.createElement('input');input.type='checkbox';input.name=key+'_enabled';input.checked=service.enabled;label.append(input,document.createTextNode(translateUI('Diese Leistung anbieten')));
  section.append(label,field(key+'_title',translateUI('Anzeigename'),service.title,80),field(key+'_description',translateUI('Beschreibung'),service.description,400,true));services.append(section);
 }
 form.elements.windowsEnabled.checked=content.windowsEnabled;
 const booking=content.booking||{enabled:true,dateEnabled:true,timeEnabled:true};
 const bookingFields=document.querySelector('#booking-fields');bookingFields.replaceChildren();
 for(const [key,label,description] of [['enabled','Accept online inquiries','Show or pause the public form'],['dateEnabled','Ask for preferred date','Let customers choose a date'],['timeEnabled','Ask for preferred time','Let customers choose a time']]){
  const item=document.createElement('label');item.className='booking-toggle';const input=document.createElement('input');input.type='checkbox';input.name='booking_'+key;input.checked=booking[key]!==false;
  const copy=document.createElement('span');const title=document.createElement('strong');title.textContent=label;const text=document.createElement('small');text.textContent=description;copy.append(title,text);item.append(input,copy);bookingFields.append(item);
 }
 renderMediaEditor(content,request,()=>{dirty=true;status.textContent=translateUI('Ungespeicherte Änderungen');});
}
export function hasSiteChanges(){return dirty;}
export function clearSiteChanges(){dirty=false;form.reset();status.textContent='';}
export async function loadSiteEditor(api,force=false){
 request=api;if(dirty&&!force)return;
 const data=await request('api/admin/site');version=data.version;render(data.content);dirty=false;status.textContent=translateUI('Gespeicherte Version geladen.');
}
form.addEventListener('input',()=>{dirty=true;status.textContent=translateUI('Ungespeicherte Änderungen');});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(!request)return;if(mediaBusy()){status.textContent=translateUI('Bitte warten, bis der Bild-Upload abgeschlossen ist.');return;}const button=event.submitter;button.disabled=true;
 const f=form.elements;
 const content={company:Object.fromEntries([...companySpecs.map(([key])=>[key,f['company_'+key].value]),['theme',f.company_theme.value]]),hero:{title:f.hero_title.value,subtitle:f.hero_subtitle.value,description:f.hero_description.value},services:{},windowsEnabled:f.windowsEnabled.checked,booking:{enabled:f.booking_enabled.checked,dateEnabled:f.booking_dateEnabled.checked,timeEnabled:f.booking_timeEnabled.checked},media:currentMedia(),testimonials:currentTestimonials()};
 for(const key of ['home','office','deep'])content.services[key]={title:f[key+'_title'].value,description:f[key+'_description'].value,enabled:f[key+'_enabled'].checked};
 try{
  const data=await request('api/admin/site',{method:'PUT',body:JSON.stringify({version,content})});version=data.version;render(data.content);dirty=false;
  document.querySelectorAll('[data-company]').forEach(node=>node.textContent=data.content.company.name);
  status.textContent=translateUI('Website gespeichert. Öffnen oder aktualisieren Sie die Kundenseite, um Ihre Änderungen zu sehen.');
 }catch(error){status.textContent=translateUI(error.message);}finally{button.disabled=false;}
});
document.querySelector('#site-reload').addEventListener('click',async()=>{
 if(mediaBusy()){status.textContent=translateUI('Bild-Upload läuft. Bitte kurz warten.');return;}
 if(dirty&&!confirm('Ungespeicherte Website-Änderungen verwerfen und gespeicherte Version laden?'))return;
 try{await loadSiteEditor(request,true);}catch(error){status.textContent=translateUI(error.message);}
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
