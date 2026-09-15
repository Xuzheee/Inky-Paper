"""List only Paper SQLite paths already opened by one Windows process."""
import argparse
import ctypes
import json
import os
from ctypes import wintypes

parser = argparse.ArgumentParser()
parser.add_argument('pid', type=int)
pid = parser.parse_args().pid
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
nt = ctypes.WinDLL('ntdll')
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.GetCurrentProcess.restype = wintypes.HANDLE
kernel.DuplicateHandle.argtypes = [wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.GetFileType.argtypes = [wintypes.HANDLE]
kernel.GetFinalPathNameByHandleW.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
nt.NtQuerySystemInformation.argtypes = [wintypes.ULONG, ctypes.c_void_p, wintypes.ULONG, ctypes.POINTER(wintypes.ULONG)]

class Entry(ctypes.Structure):
    _fields_ = [('object', ctypes.c_void_p), ('pid', ctypes.c_size_t), ('handle', ctypes.c_size_t), ('access', wintypes.ULONG), ('backtrace', wintypes.USHORT), ('type', wintypes.USHORT), ('attributes', wintypes.ULONG), ('reserved', wintypes.ULONG)]

class FileInfo(ctypes.Structure):
    _fields_ = [('attributes', wintypes.DWORD), ('created', wintypes.FILETIME), ('accessed', wintypes.FILETIME), ('written', wintypes.FILETIME), ('volume', wintypes.DWORD), ('sizeHigh', wintypes.DWORD), ('sizeLow', wintypes.DWORD), ('links', wintypes.DWORD), ('indexHigh', wintypes.DWORD), ('indexLow', wintypes.DWORD)]
kernel.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.POINTER(FileInfo)]

size = 1024 * 1024
while True:
    buffer = ctypes.create_string_buffer(size)
    required = wintypes.ULONG()
    status = nt.NtQuerySystemInformation(64, buffer, size, ctypes.byref(required))
    if status == 0:
        break
    if status & 0xffffffff != 0xc0000004:
        raise RuntimeError('Handle enumeration unavailable: %08x' % (status & 0xffffffff))
    size = max(size * 2, required.value)

process = kernel.OpenProcess(0x0040, False, pid)
if not process:
    raise ctypes.WinError(ctypes.get_last_error())
paths = set()
files = []
try:
    count = int.from_bytes(buffer.raw[:8], 'little')
    for i in range(count):
        entry = Entry.from_buffer(buffer, 16 + i * ctypes.sizeof(Entry))
        if entry.pid != pid:
            continue
        duplicate = wintypes.HANDLE()
        if not kernel.DuplicateHandle(process, entry.handle, kernel.GetCurrentProcess(), ctypes.byref(duplicate), 0, False, 2):
            continue
        try:
            if kernel.GetFileType(duplicate) != 1:
                continue
            name = ctypes.create_unicode_buffer(32768)
            if kernel.GetFinalPathNameByHandleW(duplicate, name, len(name), 0):
                if 'paper.sqlite3' in name.value or 'paper-agent-bridge.json' in name.value:
                    paths.add(name.value)
                    info = FileInfo()
                    if kernel.GetFileInformationByHandle(duplicate, ctypes.byref(info)):
                        stat = os.stat(name.value)
                        files.append({'path':name.value, 'openHandleFileId':info.indexHigh * 2**32 + info.indexLow, 'pathFileId':stat.st_ino, 'openHandleBytes':info.sizeHigh * 2**32 + info.sizeLow, 'pathBytes':stat.st_size})
        finally:
            kernel.CloseHandle(duplicate)
finally:
    kernel.CloseHandle(process)
print(json.dumps({'pid':pid,'paperOpenPaths':sorted(paths),'files':files}))
