import {estimate} from './pricing.js';
const form=document.querySelector('#quote');
const service=document.querySelector('#service'),area=document.querySelector('#area'),frequency=document.querySelector('#frequency'),windows=document.querySelector('#windows'),price=document.querySelector('#price'),result=document.querySelector('#result');
const currency=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
function update(){ result.hidden=true; try {price.value=currency.format(estimate(service.value,Number(area.value),frequency.value,windows.checked));} catch {price.value='Bitte Fläche prüfen';} }
form.addEventListener('input',update);
form.addEventListener('submit',e=>{e.preventDefault();if(!form.reportValidity())return; const total=estimate(service.value,Number(area.value),frequency.value,windows.checked);document.querySelector('#message').value=`Guten Tag! Ich interessiere mich für eine Reinigung.\nBereich: ${service.selectedOptions[0].text}\nFläche: ${area.value} m²\nRhythmus: ${frequency.selectedOptions[0].text}\nFenster: ${windows.checked?'Ja':'Nein'}\nUnverbindliche Demo-Kalkulation: ${currency.format(total)} pro Reinigung.\nBitte teilen Sie mir Verfügbarkeit und ein individuelles Angebot mit.`;result.hidden=false;document.querySelector('#message').focus();});
document.querySelectorAll('[data-service]').forEach(a=>a.addEventListener('click',()=>{service.value=a.dataset.service;update();}));
const legal=document.querySelector('#legal');document.querySelector('#legal-open').addEventListener('click',()=>legal.showModal());update();
