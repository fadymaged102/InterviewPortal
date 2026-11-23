// 1. Handles the initial request to load the questions
function doGet(e) {
  // We return JSON data instead of an HTML page!
  return jsonOut({ questions: getQuestions() });
}

// 2. Handles upload requests.
//
// Videos are uploaded in chunks through Google Drive's Resumable Upload API:
//   action "init"   -> creates a resumable upload session, returns its URI
//   action "chunk"  -> forwards one chunk (base64) to the session
//   action "status" -> asks Drive how many bytes it has committed, so the
//                      client can resume from the exact offset after a drop
// Requests without an "action" fall back to the legacy single-shot upload.
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'init':   return jsonOut(initUpload(data));
      case 'chunk':  return jsonOut(uploadChunk(data));
      case 'status': return jsonOut(uploadStatus(data));
      default:       return jsonOut(saveVideo(data.base64data, data.userEmail, data.questionIndex));
    }
  } catch (error) {
    return jsonOut({ success: false, error: error.toString() });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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

var FOLDER_NAME = "Interview_Submissions";
var DRIVE_UPLOAD_PREFIX = "https://www.googleapis.com/upload/drive/v3/files";

function getFolder() {
  var folders = DriveApp.getFoldersByName(FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
}

function buildFileName(email, questionIndex, ext) {
  var safeEmail = String(email || "unknown").replace(/[^\w@.+-]/g, "_").slice(0, 100);
  var q = (parseInt(questionIndex, 10) || 0) + 1;
  return safeEmail + "_Q" + q + "." + (ext === "mp4" ? "mp4" : "webm");
}

// --- Resumable upload ---------------------------------------------------

function initUpload(data) {
  var total = Number(data.totalBytes);
  if (!(total > 0)) return { success: false, error: "Invalid totalBytes" };
  var mimeType = String(data.mimeType || "video/webm").split(";")[0];

  var res = UrlFetchApp.fetch(DRIVE_UPLOAD_PREFIX + "?uploadType=resumable&supportsAllDrives=true", {
    method: "post",
    contentType: "application/json; charset=UTF-8",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(total)
    },
    payload: JSON.stringify({
      name: buildFileName(data.userEmail, data.questionIndex, data.ext),
      mimeType: mimeType,
      parents: [getFolder().getId()]
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var location = getHeader(res, "Location");
  if (code !== 200 || !location) {
    return { success: false, retryable: code >= 500 || code === 429, error: "Init failed (" + code + "): " + res.getContentText().slice(0, 300) };
  }
  return { success: true, sessionUri: location };
}

function uploadChunk(data) {
  var uri = checkSessionUri(data.sessionUri);
  var start = Number(data.offset);
  var total = Number(data.totalBytes);
  var bytes = Utilities.base64Decode(data.chunk);
  var end = start + bytes.length - 1;

  var res = UrlFetchApp.fetch(uri, {
    method: "put",
    contentType: "application/octet-stream",
    headers: { "Content-Range": "bytes " + start + "-" + end + "/" + total },
    payload: bytes,
    muteHttpExceptions: true,
    followRedirects: false // Drive answers 308 "Resume Incomplete"; don't treat it as a redirect
  });
  return interpretSessionResponse(res);
}

function uploadStatus(data) {
  var uri = checkSessionUri(data.sessionUri);
  var res = UrlFetchApp.fetch(uri, {
    method: "put",
    headers: { "Content-Range": "bytes */" + Number(data.totalBytes) },
    payload: "",
    muteHttpExceptions: true,
    followRedirects: false
  });
  return interpretSessionResponse(res);
}

// Converts a Drive session response into { success, done, committed, fileId }.
function interpretSessionResponse(res) {
  var code = res.getResponseCode();
  if (code === 200 || code === 201) {
    var file = JSON.parse(res.getContentText() || "{}");
    return { success: true, done: true, fileId: file.id };
  }
  if (code === 308) {
    // Range header looks like "bytes=0-1048575"; absent means nothing committed yet.
    var range = getHeader(res, "Range");
    var committed = range ? Number(range.split("-")[1]) + 1 : 0;
    return { success: true, done: false, committed: committed };
  }
  return {
    success: false,
    // 404/410: session expired or unknown -> client must start a new session
    sessionExpired: code === 404 || code === 410,
    retryable: code >= 500 || code === 429,
    error: "Drive responded " + code + ": " + res.getContentText().slice(0, 300)
  };
}

function checkSessionUri(uri) {
  uri = String(uri || "");
  if (uri.indexOf(DRIVE_UPLOAD_PREFIX + "?") !== 0) throw new Error("Invalid upload session");
  return uri;
}

function getHeader(res, name) {
  var headers = res.getAllHeaders();
  var lower = name.toLowerCase();
  for (var k in headers) {
    if (k.toLowerCase() === lower) {
      var v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return null;
}

// --- Legacy single-shot upload (kept for any cached old clients) ---------

function saveVideo(data, email, questionIndex) {
  try {
    var decodedData = Utilities.base64Decode(data);
    var blob = Utilities.newBlob(decodedData, "video/webm", buildFileName(email, questionIndex, "webm"));
    var file = getFolder().createFile(blob);
    return { success: true, fileId: file.getId() };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
