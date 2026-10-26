export function defaultSite(business = {}) {
  return {
    company:{name:business.name || 'Klarraum',phone:business.phone || '',email:business.email || '',address:business.address || '',hours:'By appointment',area:'Your local service area',theme:'forest'},
    hero:{title:'A cleaner home.',subtitle:'More room to breathe.',description:'Spend less time cleaning and more time living. Explore a service that fits your routine, with clear options and an estimate you can understand.'},
    services:{
      home:{title:'Home cleaning',description:'Kitchens, bathrooms, floors and surfaces. Come home to a space that feels cared for.',enabled:true},
      office:{title:'Office cleaning',description:'Fresh workspaces and welcoming shared areas, leaving more room for good work.',enabled:true},
      deep:{title:'Deep cleaning',description:'When your space needs more attention: a fresh start for every room.',enabled:true},
    },
    windowsEnabled:true,media:{logo:null,hero:null,gallery:[]},testimonials:[],
  };
}

export function applySite(site) {
  applySiteMedia(site);
  const set = (selector,value) => document.querySelectorAll(selector).forEach(node=>{node.textContent=value;});
  set('[data-company]',site.company.name);
  document.querySelectorAll('.logo').forEach(node=>node.setAttribute('aria-label',site.company.name+' homepage'));
  document.documentElement.dataset.theme=site.company.theme;
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
