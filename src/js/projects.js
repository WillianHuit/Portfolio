//["example.png","Titulo","Descripción",[["Github","https//:"],["View","#"]]]
let projects = [
	["dodskod.png","Dodskod Helper (BETA)","Dodskod Helper is a command response bot, programmed in NodeJS, using the Visual Code program. The JSON format was used to store data.",[["View","https://sites.google.com/view/willian/dodskodhelper"],["Glitch","https://glitch.com/edit/#!/dodsko-helper?path=README.md%3A1%3A0"]]],
	["basilik.png","Basilik","This is a university project of the Formal and Programming Languages class, carried out to obtain knowledge about: SQL, Automata and Python.",[["View","https://sites.google.com/view/willian/basilik"],["Github","https://github.com/WillianHuit/_proyectoFinal"]]],
	["sweetcakes.png","Sweet Cakes","Sweet cakes is a page with a parallax effect to promote video games, desserts, trips, etc.",[["View","https://willianhuit.github.io/IndieGames/"],["Github","https://github.com/WillianHuit/IndieGames"]]],
	["gallerypicture.png","Gallery Picture","Simple gallery to display souvenirs or promote yourself as a photographer. It has options to interact with the images.",[["View","https://willianhuit.github.io/GalleryPicture/"],["Github","https://github.com/WillianHuit/GalleryPicture"]]]
	];

function viewMore(e){
	console.log(e.childNodes);
	if(e.childNodes[1].className  == "info-project-hide"){
		e.childNodes[1].className  = "info-project-show";
	}else{
		e.childNodes[1].className  = "info-project-hide";
	}
	
}

function loadProjects(){

	let contenedor = document.getElementById('projectContent');
	let constructor = ""
	for (var i = projects.length - 1; i >= 0; i--) {
		constructor = constructor + "<div class=\"project\" ><div onclick=\"viewMore(this)\" class=\"project-compact\">";
		constructor = constructor + "<img src=\"src/img/projects/"+projects[i][0]+"\" class=\"project-img\">";
		constructor = constructor + "<div class=\"info-project-hide\">";
		constructor = constructor + "<label style=\"font-weight: bold;\">"+projects[i][1]+"</label>";
		constructor = constructor + "<p>"+projects[i][2]+"</p><div>";
		for (var j = projects[i][3].length - 1; j >= 0; j--) {
			constructor = constructor + "<a href=\""+projects[i][3][j][1]+"\" class=\"btn-source\">" + projects[i][3][j][0]+"</a>";
		}
		constructor = constructor + "</div></div></div></div>"
	}
	contenedor.innerHTML = constructor;
}
/*
function hideProjects(){
	var projects =document.getElementsByTagName("div");
	for (var i = 0; i < projects.length; i++) {
			if(projects[i].className=="project"){
				projects[i].className = "project-off";
			}
		}
}
function showProjects(){
	var projects =document.getElementsByTagName("div");
	for (var i = 0; i < projects.length; i++) {
		if(projects[i].className=="project-off" || projects[i].className=="project-on"){
				projects[i].className = "project";
			}
			
		}
}
<div class="project" >
				<div onclick="viewMore(this)" class="project-compact">
					<img src="src/img/projects/example.png" class="project-img">
					<div class="info-project-hide">
						<label style="font-weight: bold;">Plantilla Web Gratuita: Shicso</label>
						<p>Advertencia: El vendedor de este producto no proporciona asistencia técnica para productos gratuitos. Los productos gratuitos se pueden usar solo con fines educativos.</p>
						<div>
							<a href="#" class="btn-source">Github<a>
							<a href="#" class="btn-source">View<a>
							<a href="#" class="btn-source">Youtube<a>
						</div>
					</div>
				</div>
		</div>


<div class="project" >
				<div onclick="viewMore(this)" class="project-compact">
				<img src="src/img/projects/example.png" class="project-img">

					<div class="info-project-hide">
						<label style="font-weight: bold;">Plantilla Web Gratuita: Shicso</label>
						<p>Advertencia: El vendedor de este producto no proporciona asistencia técnica para productos gratuitos. Los productos gratuitos se pueden usar solo con fines educativos.</p>
						<div>
							<a href="#">
							<img title="Github" class="svg-img-lt" src="src/svg/Github.svg"></a>
							<img title="Github" class="svg-img-lt" src="src/svg/Github.svg">
							<img title="Github" class="svg-img-lt" src="src/svg/Github.svg">
						</div>
					</div>
				</div>
		</div>
*/