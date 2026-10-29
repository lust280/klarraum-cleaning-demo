export function defaultSite(business = {}) {
  return {
    company:{name:business.name || 'Klarraum',phone:business.phone || '',email:business.email || '',address:business.address || '',hours:'By appointment',area:'Your local service area',theme:'light'},
    hero:{title:'Get a clean home in minutes',subtitle:'Professional, reliable cleaning.',description:'Booked in seconds, done to perfection.'},
    services:{
      home:{title:'Home',description:'House or apartment.',enabled:true},
      office:{title:'Office',description:'Workplace care.',enabled:true},
      deep:{title:'Deep clean',description:'Extra attention.',enabled:true},
    },
    windowsEnabled:true,tipEnabled:true,booking:{enabled:true,dateEnabled:true,timeEnabled:true},media:{logo:null,hero:null,gallery:[]},testimonials:[],
  };
}

export function applySite(site) {
  applySiteMedia(site);
  const set = (selector,value) => document.querySelectorAll(selector).forEach(node=>{node.textContent=value;});
  set('[data-company]',site.company.name);
  document.querySelectorAll('.logo').forEach(node=>node.setAttribute('aria-label',site.company.name+' homepage'));
  // The public booking flow has one deliberate visual language.  Older company
  // records may still contain the former dark palettes, but they must not turn
  // this screen into a second, incompatible product.
  document.documentElement.dataset.theme='light';
  document.title=`${site.company.name} — ${site.company.area}`;
  const meta=document.querySelector('meta[name="description"]');if(meta)meta.content=`${site.company.name}: ${site.hero.description}`;
  set('#hero-title',site.hero.title);set('#hero-subtitle',site.hero.subtitle);set('#hero-description',site.hero.description);
  set('#service-area',`Cleaning · ${site.company.area}`);set('#footer-location',site.company.area);
  for(const [key,item] of Object.entries(site.services)){
    const card=document.querySelector(`[data-service-card="${key}"]`);
    if(card){card.hidden=!item.enabled;card.querySelector('h3').textContent=item.title;card.querySelector('p').textContent=item.description;}
    const promise=document.querySelector(`[data-service-promise="${key}"]`);if(promise){promise.hidden=!item.enabled;promise.textContent=item.title;}
    const option=document.querySelector(`#service option[value="${key}"]`);
    if(option){option.textContent=item.title;option.disabled=!item.enabled;option.hidden=!item.enabled;}
  }
  const select=document.querySelector('#service');
  if(select && !site.services[select.value]?.enabled)select.value=Object.keys(site.services).find(key=>site.services[key].enabled);
  const windows=document.querySelector('#windows');
  if(windows){windows.closest('label').hidden=!site.windowsEnabled;if(!site.windowsEnabled)windows.checked=false;}
  const tips=document.querySelector('.tip-picker');if(tips)tips.hidden=site.tipEnabled===false;
  const booking={enabled:true,dateEnabled:true,timeEnabled:true,...(site.booking||{})};
  const quote=document.querySelector('#quote');
  if(quote){
    quote.hidden=!booking.enabled;
    const date=document.querySelector('#date'), time=document.querySelector('#preferred-time');
    const hideControl=(input,shown)=>{if(!input)return;const field=input.closest('.when-field')||input.closest('label');if(field)field.hidden=!shown;if(!shown)input.value='';};
    hideControl(date,booking.dateEnabled);
    hideControl(time,booking.timeEnabled);
  }
  const requestIntro=document.querySelector('#booking-unavailable');
  if(requestIntro)requestIntro.hidden=booking.enabled;
  set('#contact-company',site.company.name);set('#contact-hours',site.company.hours);set('#contact-address',site.company.address);
  const phone=document.querySelector('#contact-phone'),email=document.querySelector('#contact-email');
  if(phone){phone.hidden=!site.company.phone;phone.textContent=site.company.phone;phone.href='tel:'+site.company.phone.replace(/[^+\d]/g,'');}
  if(email){email.hidden=!site.company.email;email.textContent=site.company.email;email.href='mailto:'+site.company.email;}
  const contact=document.querySelector('#business-contact');if(contact)contact.hidden=!(site.company.email||site.company.phone||site.company.address);
}

export function applySiteMedia(site){
 const media=site.media||{logo:null,hero:null,gallery:[]};
 for(const logo of document.querySelectorAll('.logo')){
  let img=logo.querySelector('.company-logo');
  if(!img){img=document.createElement('img');img.className='company-logo';img.alt='';logo.prepend(img);}
  img.hidden=!media.logo;if(media.logo)img.src=new URL(`media/${media.logo}.webp`,location.href).href;else img.removeAttribute('src');
  const mark=logo.querySelector('.mark');if(mark)mark.hidden=Boolean(media.logo);
 }
 const hero=document.querySelector('#hero-photo');
 if(hero){
  const scene=hero.parentElement;scene.classList.toggle('has-photo',Boolean(media.hero));hero.hidden=!media.hero;
  if(media.hero){hero.src=new URL(`media/${media.hero}.webp`,location.href).href;hero.alt=`Photo from ${site.company.name}`;scene.removeAttribute('role');scene.removeAttribute('aria-label');}
  else{hero.removeAttribute('src');scene.setAttribute('role','img');scene.setAttribute('aria-label','Illustration of a bright living room with a sofa, plant and sunlight');}
 }
 const gallery=document.querySelector('#photo-gallery'),grid=document.querySelector('#gallery-grid');
 if(gallery&&grid){
  gallery.hidden=!media.gallery.length;
  grid.replaceChildren(...media.gallery.map(item=>{
   const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');
   image.src=new URL(`media/${item.id}.webp`,location.href).href;image.alt=item.caption;image.loading='lazy';image.decoding='async';caption.textContent=item.caption;figure.append(image,caption);return figure;
  }));
 }
 const section=document.querySelector('#testimonials'),reviews=document.querySelector('#testimonial-grid');
 if(section&&reviews){
  section.hidden=!site.testimonials?.length;
  reviews.replaceChildren(...(site.testimonials||[]).map(item=>{
   const quote=document.createElement('blockquote'),text=document.createElement('p'),name=document.createElement('footer');text.textContent=item.text;name.textContent=item.name;quote.append(text,name);return quote;
  }));
 }
}
