// 1. Handles the initial request to load the questions
function doGet(e) {
  // We return JSON data instead of an HTML page!
  return ContentService.createTextOutput(JSON.stringify({ questions: getQuestions() }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 2. Handles the request to save the video
function doPost(e) {
  try {
    // Parse the data sent fully from the external HTML file
    var data = JSON.parse(e.postData.contents);
    var result = saveVideo(data.base64data, data.userEmail, data.questionIndex);
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Configuration: Edit your questions here
function getQuestions() {
  return [
    "Tell us about yourself and your background.",
    "Tell us about the most challenging test automation scenario you have successfully implemented or resolved.",
    "Walk us through your ideal Defect Lifecycle from discovery to closure.",
    "Describe the strategies and techniques you have used to handle test data for a complex application.",
    "How do you handle a scenario where a developer consistently pushes back on fixing a defect you have logged, arguing it’s a low priority or a 'feature'?"
  ];
}

// Your existing Drive logic
function saveVideo(data, email, questionIndex) {
  try {
    // 1. Get or Create Folder
    var folderName = "Interview_Submissions";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder;
    
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }
    
    // 2. Decode Base64 
    var decodedData = Utilities.base64Decode(data);
    var blob = Utilities.newBlob(decodedData, "video/webm", email + "_Q" + (questionIndex + 1) + ".webm");
    
    // 3. Save File
    var file = folder.createFile(blob);
    
    return { success: true, fileId: file.getId() };
    
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
