const sections = document.querySelectorAll('section');
const items = document.querySelectorAll('div .nav-items a');
let navbar = document.getElementById('navbar');
let menuShowing = false;
//home
window.addEventListener('scroll', ()=>{
	let current = '';
	sections.forEach(section =>{
		const sectionTop  = section.offsetTop;
		const sectionHeight = section.clientHeight;
		if(pageYOffset >= (sectionTop-sectionHeight/3)){
			current = section.getAttribute('id');
		}
	});
	items.forEach(item => {
		item.classList.remove('active');
		if(item.classList.contains(current)){
			item.classList.add('active');
		}
		if(current!="home"){
			navbar.classList.remove('bar-transparent');
		}else{
			navbar.classList.add('bar-transparent');
		}
	});

});

window.onload=function() {
	const date = new Date();
	const year = date.getFullYear();
	let footer = document.getElementById('year');
	footer.innerHTML = year;
}

function newPage(e){
	let link = e.id;
	window.open(link);
	
}
function showConfig(){
	let menu = document.getElementById("navbar");
	let items = document.getElementById("expand");
	if(menuShowing){
		menu.classList.remove("nav-bar-expand");
		items.className = "nav-items";
		menuShowing = false;
	}
	menu = document.getElementById('menu');
	if(menu.className=="menu-in"){
		menu.className = "menu-out";
	}else{
		menu.className = "menu-in";
	}
}
function showMenu(){
	let menu = document.getElementById("navbar");
	let items = document.getElementById("expand");
	let list = "nav-bar bar-transparent";
	if(list == menu.className || menu.className == "nav-bar"){
		menu.classList.add("nav-bar-expand");
		items.className = "nav-items-show";
		menuShowing = true;
	}else{
		menu.classList.remove("nav-bar-expand");
		items.className = "nav-items";
		menuShowing = false;
	}
	
}

function themeChange(e){
	if(e.className != "option select"){
		if(e.id=="T1"){
			localStorage.theme="light";

		}
		else{
			localStorage.theme="dark";
		}
		getChange();
	}

}
function lenguaChange(e){
	let l1 = document.getElementById('L1');
	let l2 = document.getElementById("L2");

	if(e.className != "option select"){
		if(e.id=="L1"){
			l2.classList.remove("select");
			l1.classList.add("select");
			localStorage.lenguage="english";
			 window.location="../index.html";
		}
		else{
			l1.classList.remove("select");
			l2.classList.add("select");
			localStorage.lenguage="spanish";
			window.location="es/index.html";
		}
	}
}
function menuHide(){
	let menu = document.getElementById("navbar");
	let items = document.getElementById("expand");
	if(menuShowing){
		menu.classList.remove("nav-bar-expand");
		items.className = "nav-items";
		menuShowing = false;
	}
}

if(typeof(Storage) !== "undefined"){
	let lenguage = document.getElementById("lenguage").innerHTML;
	if(localStorage.theme==null){
		localStorage.setItem("theme", "light");
		localStorage.setItem("lenguage", "english");
	}else{
		getChange();
		if(localStorage.lenguage=="spanish" && lenguage=="English"){
			window.location="es/index.html";
		}
	}
	
}else{
	alert("Sorry! No Web Storage support..");
}

function getChange(){
	let dark = document.getElementById("T2");
	let light = document.getElementById('T1');
	let body = document.getElementById("content");
	if(localStorage.theme=="dark"){
		dark.classList.add("select");
		light.classList.remove("select");
		body.classList.add("dark-mode");
	}else{
		dark.classList.remove("select");
		light.classList.add("select");
		body.classList.remove("dark-mode");
	}
}