/* =====================================================
   Reading OS
   Import System

   Import:
   EPUB
   TXT
   MOBI
   AZW3

===================================================== */



// ===============================
// 支持格式
// ===============================


const SUPPORT_FORMATS = [

    "epub",

    "txt",

    "mobi",

    "azw3"

];









// ===============================
// 打开文件选择
// ===============================


function importBook(){



    let input =

    document.createElement(
        "input"
    );



    input.type =
    "file";



    input.accept =

    ".epub,.txt,.mobi,.azw3";





    input.onchange =

    function(e){



        let file =

        e.target.files[0];



        if(file){


            handleFile(
                file
            );


        }



    };





    input.click();



}









// ===============================
// 处理文件
// ===============================


async function handleFile(
file
){



    let ext =

    getExtension(
        file.name
    );





    if(
    !SUPPORT_FORMATS.includes(
        ext
    )
    ){


        alert(
        "暂不支持该格式"
        );


        return;


    }






    let book =

    createBookData(
        file,
        ext
    );





    await addBook(

        book,

        file

    );





    alert(

    "《"

    +

    book.title

    +

    "》已加入书架"

    );





    // 刷新书架

    if(
    typeof initApp === "function"
    ){


        initApp();


    }



}









// ===============================
// 创建书籍信息
// ===============================


function createBookData(
file,
ext
){



    let title =

    file.name

    .replace(
        /\.[^/.]+$/,
        ""
    );





    return {


        id:

        Date.now(),



        title:title,



        author:

        "未知作者",



        cover:

        "assets/default-cover.jpg",



        description:

        "暂无简介",



        tags:

        [
            "未分类"
        ],



        type:

        ext,



        fileName:

        file.name,



        size:

        file.size,



        progress:

        0,



        status:

        "未读",



        readTime:

        0,



        notes:

        [],



        createTime:

        new Date()

        .toLocaleString()



    };



}









// ===============================
// 获取文件后缀
// ===============================


function getExtension(
filename
){



    return filename

    .split(".")

    .pop()

    .toLowerCase();



}









// ===============================
// 拖拽导入
// ===============================


function enableDropImport(){



    let area =

    document.querySelector(
        ".bookshelf-container"
    );





    if(!area)
    return;






    area.addEventListener(

    "dragover",

    function(e){


        e.preventDefault();


        area.classList.add(
            "dragging"
        );


    }

    );








    area.addEventListener(

    "dragleave",

    function(){


        area.classList.remove(
            "dragging"
        );


    }

    );








    area.addEventListener(

    "drop",

    function(e){



        e.preventDefault();




        area.classList.remove(
            "dragging"
        );





        let files =

        e.dataTransfer.files;





        if(
        files.length
        ){


            handleFile(
                files[0]
            );


        }




    }

    );



}









// ===============================
// 批量导入
// ===============================


async function importMultiple(
files
){



    for(
    let file of files
    ){


        await handleFile(
            file
        );


    }



}









// ===============================
// 暴露函数
// ===============================


window.importBook =
importBook;


window.handleFile =
handleFile;


window.enableDropImport =
enableDropImport;


window.importMultiple =
importMultiple;// JavaScript Document