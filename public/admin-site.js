import {applySiteMedia} from './site.js';
import {renderMediaEditor,currentMedia,currentTestimonials,mediaBusy} from './admin-media.js';
let request,version=0,dirty=false;
const form=document.querySelector('#site-form'),status=document.querySelector('#site-status');
const companySpecs=[['name','Markenname',80],['phone','Öffentliche Telefonnummer',40],['email','Öffentliche E-Mail',254],['address','Öffentliche Adresse',200],['hours','Erreichbarkeit / Öffnungszeiten',160],['area','Region / Einsatzgebiet (Anzeige)',100]];
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
 const themeLabel=document.createElement('label');themeLabel.textContent='Farbwelt';const theme=document.createElement('select');theme.name='company_theme';
 for(const [value,label] of [['forest','Waldgrün'],['navy','Nachtblau'],['clay','Terrakotta']]){const option=document.createElement('option');option.value=value;option.textContent=label;theme.append(option);}theme.value=content.company.theme;themeLabel.append(theme);company.append(themeLabel);
 document.querySelector('#hero-fields').replaceChildren(field('hero_title','Hauptüberschrift',content.hero.title,100),field('hero_subtitle','Zweite Überschrift',content.hero.subtitle,100),field('hero_description','Einleitung',content.hero.description,600,true));
 const services=document.querySelector('#service-fields');services.replaceChildren();
 for(const [key,service] of Object.entries(content.services)){
  const section=document.createElement('fieldset');section.className='service-editor';const legend=document.createElement('legend');legend.textContent={home:'Wohnung / Haus',office:'Büro / Gewerbe',deep:'Grundreinigung'}[key];section.append(legend);
  const label=document.createElement('label');label.className='checkbox';const input=document.createElement('input');input.type='checkbox';input.name=key+'_enabled';input.checked=service.enabled;label.append(input,document.createTextNode('Diese Leistung anbieten'));
  section.append(label,field(key+'_title','Anzeigename',service.title,80),field(key+'_description','Beschreibung',service.description,400,true));services.append(section);
 }
 form.elements.windowsEnabled.checked=content.windowsEnabled;
 renderMediaEditor(content,request,()=>{dirty=true;status.textContent='Ungespeicherte Änderungen';});
}
export function hasSiteChanges(){return dirty;}
export function clearSiteChanges(){dirty=false;form.reset();status.textContent='';}
export async function loadSiteEditor(api,force=false){
 request=api;if(dirty&&!force)return;
 const data=await request('api/admin/site');version=data.version;render(data.content);dirty=false;status.textContent='Gespeicherte Version geladen.';
}
form.addEventListener('input',()=>{dirty=true;status.textContent='Ungespeicherte Änderungen';});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(!request)return;if(mediaBusy()){status.textContent='Bitte warten, bis der Bild-Upload abgeschlossen ist.';return;}const button=event.submitter;button.disabled=true;
 const f=form.elements;
 const content={company:Object.fromEntries([...companySpecs.map(([key])=>[key,f['company_'+key].value]),['theme',f.company_theme.value]]),hero:{title:f.hero_title.value,subtitle:f.hero_subtitle.value,description:f.hero_description.value},services:{},windowsEnabled:f.windowsEnabled.checked,media:currentMedia(),testimonials:currentTestimonials()};
 for(const key of ['home','office','deep'])content.services[key]={title:f[key+'_title'].value,description:f[key+'_description'].value,enabled:f[key+'_enabled'].checked};
 try{
  const data=await request('api/admin/site',{method:'PUT',body:JSON.stringify({version,content})});version=data.version;render(data.content);dirty=false;
  document.querySelectorAll('[data-company]').forEach(node=>node.textContent=data.content.company.name);
  status.textContent='Website gespeichert. Öffnen oder aktualisieren Sie die Kundenseite, um Ihre Änderungen zu sehen.';
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
document.querySelector('#site-reload').addEventListener('click',async()=>{
 if(mediaBusy()){status.textContent='Bild-Upload läuft. Bitte kurz warten.';return;}
 if(dirty&&!confirm('Ungespeicherte Website-Änderungen verwerfen und gespeicherte Version laden?'))return;
 try{await loadSiteEditor(request,true);}catch(error){status.textContent=error.message;}
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
