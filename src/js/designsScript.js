const date = new Date();
const year = date.getFullYear();
document.getElementById('year').innerHTML = year;

if(document.querySelector(".image-gallery")) {
	gsap.timeline({
		defaults:{
			duration: 1,
			delay: 0.5,
			stagger: 0.05,
			ease: "elastic.inOut(3)"
		}
	}).to('.onli-text',{
		scale: 2
	}).to('.onli-text',{
		scale: 1
	});
	}

let options={
	root: null,
	rootMargin: '0px',
	threshold: 0.25
};
let callback = (entries, observer)=>{
	entries.forEach(entry=>{
		if(entry.isIntersecting && entry.target.className ==='image-gallery'){
			let imageUrl = entry.target.getAttribute('data-img');
			if(imageUrl){
				entry.target.src = imageUrl;
				observer.unobserve(entry.target);
			}
		}
	});
};
let observer = new IntersectionObserver(callback, options);
observer.observe(document.querySelector('#img1'));
observer.observe(document.querySelector('#img2'));
observer.observe(document.querySelector('#img3'));
observer.observe(document.querySelector('#img4'));
observer.observe(document.querySelector('#img5'));
observer.observe(document.querySelector('#img6'));
observer.observe(document.querySelector('#img7'));
observer.observe(document.querySelector('#img8'));
observer.observe(document.querySelector('#img9'));
observer.observe(document.querySelector('#img10'));
observer.observe(document.querySelector('#img11'));
observer.observe(document.querySelector('#img12'));
observer.observe(document.querySelector('#img13'));
observer.observe(document.querySelector('#img14'));
observer.observe(document.querySelector('#img15'));