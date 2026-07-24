/* =====================================================
   Reading OS
   Storage System

   localStorage:
   保存书籍信息

   IndexedDB:
   保存电子书文件

===================================================== */



const DB_NAME = "ReadingOS_DB";

const DB_VERSION = 1;

const STORE_NAME = "books_files";





// ===============================
// localStorage
// ===============================


function getBooks(){


    return JSON.parse(

        localStorage.getItem(
            "books"
        )
        ||
        "[]"

    );


}







function saveBooks(books){


    localStorage.setItem(

        "books",

        JSON.stringify(
            books
        )

    );


}









// ===============================
// IndexedDB 初始化
// ===============================


function openDB(){


    return new Promise(
    (resolve,reject)=>{


        let request =

        indexedDB.open(

            DB_NAME,

            DB_VERSION

        );





        request.onupgradeneeded =

        function(e){


            let db =

            e.target.result;





            if(
            !db.objectStoreNames.contains(
                STORE_NAME
            )
            ){


                db.createObjectStore(

                    STORE_NAME,

                    {
                        keyPath:"id"
                    }

                );


            }



        };





        request.onsuccess =

        function(e){


            resolve(
                e.target.result
            );


        };





        request.onerror =

        function(){


            reject(
                "数据库打开失败"
            );


        };



    });



}









// ===============================
// 保存电子书文件
// ===============================


async function saveFile(
bookId,
file
){



    let db =

    await openDB();





    return new Promise(
    (resolve,reject)=>{


        let transaction =

        db.transaction(

            STORE_NAME,

            "readwrite"

        );





        let store =

        transaction.objectStore(
            STORE_NAME
        );





        store.put({

            id:bookId,

            file:file


        });





        transaction.oncomplete =

        function(){


            resolve(true);


        };





        transaction.onerror =

        function(){


            reject(false);


        };



    });


}









// ===============================
// 获取电子书文件
// ===============================


async function getFile(
bookId
){



    let db =

    await openDB();





    return new Promise(
    (resolve,reject)=>{


        let transaction =

        db.transaction(

            STORE_NAME,

            "readonly"

        );





        let store =

        transaction.objectStore(
            STORE_NAME
        );





        let request =

        store.get(
            bookId
        );





        request.onsuccess =

        function(){


            resolve(
                request.result
            );


        };





        request.onerror =

        function(){


            reject(null);


        };



    });



}









// ===============================
// 删除电子书文件
// ===============================


async function deleteFile(
bookId
){



    let db =

    await openDB();





    return new Promise(
    (resolve)=>{


        let transaction =

        db.transaction(

            STORE_NAME,

            "readwrite"

        );





        transaction

        .objectStore(
            STORE_NAME
        )

        .delete(
            bookId
        );





        transaction.oncomplete =
        ()=>resolve(true);



    });



}









// ===============================
// 添加书籍
// ===============================


async function addBook(
book
,
file
){



    let books =

    getBooks();





    books.push(
        book
    );





    saveBooks(
        books
    );





    if(file){


        await saveFile(

            book.id,

            file

        );


    }





    return book;


}









// ===============================
// 更新书籍
// ===============================


function updateBook(
updatedBook
){



    let books =

    getBooks();





    let index =

    books.findIndex(

        b=>

        b.id === updatedBook.id

    );





    if(index!==-1){


        books[index] =

        updatedBook;


        saveBooks(
            books
        );


    }



}









// ===============================
// 删除书籍
// ===============================


async function deleteBook(
id
){



    let books =

    getBooks();





    books =

    books.filter(

        b=>

        b.id !== id

    );





    saveBooks(
        books
    );





    await deleteFile(
        id
    );



}









// ===============================
// 获取单本书
// ===============================


function getBookById(
id
){



    let books =

    getBooks();





    return books.find(

        b=>

        b.id===id

    );


}









// ===============================
// 更新阅读进度
// ===============================


function updateProgress(
id,
progress
){



    let book =

    getBookById(
        id
    );





    if(book){


        book.progress =

        progress;


        updateBook(
            book
        );


    }


}









// ===============================
// 保存阅读位置
// ===============================


function savePosition(
id,
position
){



    let book =

    getBookById(
        id
    );





    if(book){


        book.position =

        position;


        updateBook(
            book
        );


    }



}









// ===============================
// 保存笔记
// ===============================


function addNote(
id,
note
){



    let book =

    getBookById(
        id
    );





    if(!book.notes){


        book.notes=[];


    }





    book.notes.push({

        text:note,

        time:
        new Date()
        .toLocaleString()


    });





    updateBook(
        book
    );



}









// ===============================
// 清空所有数据
// ===============================


async function clearStorage(){



    localStorage.removeItem(
        "books"
    );



    let db =

    await openDB();





    let transaction =

    db.transaction(

        STORE_NAME,

        "readwrite"

    );





    transaction

    .objectStore(
        STORE_NAME
    )

    .clear();



}









// ===============================
// 导出函数
// ===============================


window.getBooks =
getBooks;


window.saveBooks =
saveBooks;


window.addBook =
addBook;


window.updateBook =
updateBook;


window.deleteBook =
deleteBook;


window.getBookById =
getBookById;


window.saveFile =
saveFile;


window.getFile =
getFile;


window.updateProgress =
updateProgress;


window.savePosition =
savePosition;


window.addNote =
addNote;


window.clearStorage =
clearStorage;