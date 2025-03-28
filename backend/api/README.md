# Remote Disk Management API

This API allows you to manage your disks and files remotely through HTTP requests.

## Authentication

All API requests require authentication using an API key. You can provide the API key in one of the following ways:

1. As an `x-api-key` header:
   ```
   x-api-key: your-api-key
   ```

2. As a query parameter:
   ```
   ?api_key=your-api-key
   ```

## Disk Management

### Get List of Disks

Retrieves a list of all available disks.

```
GET /api/remote/disks
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "disk_sdb",
      "mountPoint": "/mnt/storage/sdb",
      "status": "online"
    },
    {
      "name": "disk_sdc",
      "mountPoint": "/mnt/storage/sdc",
      "status": "offline"
    }
  ]
}
```

### Rename a Disk

Renames a disk.

```
POST /api/remote/disks/rename
```

**Request Body:**
```json
{
  "diskId": "disk_sdb",
  "newName": "main_storage"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Disk 'disk_sdb' renamed to 'main_storage'",
  "data": {
    "name": "main_storage",
    "mountPoint": "/mnt/storage/sdb",
    "status": "online"
  }
}
```

### Rename Multiple Disks

Renames multiple disks at once.

```
POST /api/remote/disks/rename-bulk
```

**Request Body:**
```json
{
  "disks": [
    {
      "diskId": "disk_sdb",
      "newName": "main_storage"
    },
    {
      "diskId": "disk_sdc",
      "newName": "backup_storage"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "2 disks renamed successfully",
  "data": [
    {
      "oldName": "disk_sdb",
      "newName": "main_storage",
      "mountPoint": "/mnt/storage/sdb",
      "status": "online"
    },
    {
      "oldName": "disk_sdc",
      "newName": "backup_storage",
      "mountPoint": "/mnt/storage/sdc",
      "status": "offline"
    }
  ]
}
```

## File Management

### Upload a File

Uploads a file to a specified disk and path. Creates directories if they don't exist.

```
POST /api/remote/files/:diskId/upload
```

**Request Parameters:**
- `diskId`: The ID of the disk to upload to

**Request Body (Form Data):**
- `file`: The file to upload
- `filePath`: The target path on the disk, including any directories to create (e.g., "my/nested/directory/file.txt")

**Response:**
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "disk": "disk_sdb",
    "path": "my/nested/directory/file.txt",
    "size": 12345,
    "name": "file.txt"
  }
}
```

### Download a File

Downloads a file from a specified disk and path.

```
GET /api/remote/files/:diskId/download?filePath=path/to/file.txt
```

**Request Parameters:**
- `diskId`: The ID of the disk to download from
- `filePath` (query): The path of the file to download

**Response:**
The file content with appropriate headers for download.

### Search Files

Searches for files or directories by name or regex pattern.

```
GET /api/remote/files/:diskId/search?pattern=searchterm&isRegex=false&type=all
```

**Request Parameters:**
- `diskId`: The ID of the disk to search in
- `pattern` (query): The search pattern
- `isRegex` (query, optional): Whether the pattern is a regex (default: false)
- `type` (query, optional): Type of items to search for - "files", "directories", or "all" (default: all)

**Response:**
```json
{
  "success": true,
  "data": {
    "disk": "disk_sdb",
    "pattern": "searchterm",
    "isRegex": false,
    "type": "all",
    "results": [
      {
        "path": "path/to/file.txt",
        "name": "file.txt"
      },
      {
        "path": "another/path/searchterm_file.pdf",
        "name": "searchterm_file.pdf"
      }
    ],
    "count": 2
  }
}
```

### Delete Files

Deletes files by pattern or specific path.

```
DELETE /api/remote/files/:diskId/delete
```

**Request Parameters:**
- `diskId`: The ID of the disk to delete from

**Request Body:**
```json
{
  "pattern": "path/to/file.txt",
  "isRegex": false,
  "confirm": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "1 files deleted, 0 errors",
  "data": {
    "disk": "disk_sdb",
    "deleted": [
      "path/to/file.txt"
    ],
    "errors": [],
    "totalDeleted": 1,
    "totalErrors": 0
  }
}
```

## Examples

### Uploading a file with curl

```bash
curl -X POST \
  -H "x-api-key: your-api-key" \
  -F "file=@/path/to/local/file.txt" \
  -F "filePath=remote/folder/file.txt" \
  http://iqbanana.online/api/remote/files/disk_sdb/upload
```

### Downloading a file with curl

```bash
curl -X GET \
  -H "x-api-key: your-api-key" \
  -o downloaded_file.txt \
  "http://iqbanana.online/api/remote/files/disk_sdb/download?filePath=remote/folder/file.txt"
```

### Searching for files with curl

```bash
curl -X GET \
  -H "x-api-key: your-api-key" \
  "http://iqbanana.online/api/remote/files/disk_sdb/search?pattern=report&type=files"
```

### Deleting files with curl

```bash
curl -X DELETE \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "temp/*.log", "confirm": true}' \
  http://iqbanana.online/api/remote/files/disk_sdb/delete
``` 