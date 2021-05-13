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
	})
	.to('.image-gallery',{
		rotate: 360,
		y: 50
	})
	.to('.image-gallery',{
		y:0
	});
	}