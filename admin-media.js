let media={logo:null,hero:null,gallery:[]},request,changed,busy=0;
const $=s=>document.querySelector(s);
export function mediaBusy(){return busy>0;}
export function currentMedia(){return structuredClone(media);}
export function currentTestimonials(){return [0,1,2].map(i=>({name:$(`[name="review_name_${i}"]`).value.trim(),text:$(`[name="review_text_${i}"]`).value.trim()})).filter(item=>item.name||item.text);}
function node(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
function button(text,action){const el=node('button',text);el.type='button';el.className='button small secondary';el.addEventListener('click',action);return el;}
function image(id){const el=node('img');el.src=new URL(`media/${id}.webp`,location.href).href;el.alt='Bildvorschau';el.loading='lazy';return el;}
function message(text){$('#media-status').textContent=text;}
function modified(){changed();message('Bildauswahl geändert. Mit „Website speichern“ veröffentlichen.');}
function renderSelected(){
 for(const kind of ['logo','hero']){
  const box=$(`#selected-${kind}`);box.replaceChildren();
  if(media[kind])box.append(image(media[kind]),button('Aus Website entfernen',()=>{media[kind]=null;modified();renderSelected();}));
  else box.append(node('p',kind==='logo'?'Noch kein eigenes Logo.':'Ohne Foto bleibt die Illustration sichtbar.'));
 }
 const gallery=$('#selected-gallery');gallery.replaceChildren();
 media.gallery.forEach((item,index)=>{
  const card=node('div');card.className='gallery-edit-card';const label=node('label','Bildbeschreibung / Bildunterschrift');const caption=node('input');caption.value=item.caption;caption.maxLength=160;caption.required=true;caption.addEventListener('input',()=>{media.gallery[index].caption=caption.value;changed();});label.append(caption);
  card.append(image(item.id),label,button('Entfernen',()=>{media.gallery.splice(index,1);modified();renderSelected();}),button('Nach vorne',()=>{if(index){[media.gallery[index-1],media.gallery[index]]=[media.gallery[index],media.gallery[index-1]];modified();renderSelected();}}));gallery.append(card);
 });
}
async function library(){
 const data=await request('api/admin/media');const container=$('#media-library');container.replaceChildren();
 $('#media-count').textContent=`${data.items.length} von 40 Bildern im Speicher`;
 for(const item of data.items){
  const card=node('div');card.className='library-card';const description=node('span',`${item.kind} · ${item.width} × ${item.height} · ${Math.ceil(item.size/1024)} KB${item.used?' · veröffentlicht':''}`);
  const remove=button('Datei löschen',async()=>{
   const draftIds=[media.logo,media.hero,...media.gallery.map(x=>x.id)];
   if(draftIds.includes(item.id)){message('Das Bild ist noch ausgewählt. Erst aus der Auswahl entfernen und Website speichern.');return;}
   if(!confirm('Nicht verwendete Bilddatei endgültig löschen?'))return;
   remove.disabled=true;try{await request(`api/admin/media/${item.id}`,{method:'DELETE'});await library();message('Nicht verwendete Datei gelöscht.');}catch(error){message(error.message);}finally{remove.disabled=false;}
  });remove.disabled=item.used;
  const reuse=button('Wieder verwenden',()=>{
   if(item.kind==='gallery'){
    if(media.gallery.some(image=>image.id===item.id)){message('Dieses Bild ist bereits in der Galerie ausgewählt.');return;}
    if(media.gallery.length>=8){message('Maximal acht Galeriebilder.');return;}
    media.gallery.push({id:item.id,caption:''});
   }else media[item.kind]=item.id;
   modified();renderSelected();
  });
  card.append(image(item.id),description,reuse,remove);container.append(card);
 }
}
export function renderMediaEditor(content,api,onChange){
 request=api;changed=onChange;media=structuredClone(content.media||{logo:null,hero:null,gallery:[]});renderSelected();
 const reviews=$('#review-fields');reviews.replaceChildren();
 for(let i=0;i<3;i++){
  const item=content.testimonials?.[i]||{name:'',text:''};const section=node('fieldset');const legend=node('legend',`Kundenstimme ${i+1} (optional)`);section.append(legend);
  const nameLabel=node('label','Freigegebener Anzeigename');const name=node('input');name.name=`review_name_${i}`;name.maxLength=80;name.value=item.name;nameLabel.append(name);
  const textLabel=node('label','Originaler oder abgestimmter Bewertungstext');const text=node('textarea');text.name=`review_text_${i}`;text.rows=3;text.maxLength=600;text.value=item.text;textLabel.append(text);section.append(nameLabel,textLabel);reviews.append(section);
 }
 library().catch(error=>message(error.message));
}
for(const input of document.querySelectorAll('[data-upload-kind]'))input.addEventListener('change',async()=>{
 const file=input.files[0];if(!file||!request)return;const kind=input.dataset.uploadKind;
 if(file.size>5*1024*1024){message('Bitte ein Bild bis 5 MB wählen.');input.value='';return;}
 if(kind==='gallery'&&media.gallery.length>=8){message('Maximal acht Galeriebilder. Erst ein Bild aus der Auswahl entfernen.');input.value='';return;}
 busy++;input.disabled=true;$('#site-form button[type="submit"]').disabled=true;message('Bild wird geprüft und optimiert …');
 try{
  const item=await request(`api/admin/media?kind=${kind}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
  if(kind==='gallery')media.gallery.push({id:item.id,caption:''});else media[kind]=item.id;
  modified();renderSelected();await library();
 }catch(error){message(error.message);}finally{busy--;input.disabled=false;input.value='';$('#site-form button[type="submit"]').disabled=busy>0;}
});
