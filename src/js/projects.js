

function viewMore(e){
	console.log(e.childNodes);
	if(e.childNodes[1].className  == "info-project-hide"){
		e.childNodes[1].className  = "info-project-show";
	}else{
		e.childNodes[1].className  = "info-project-hide";
	}
	
}
