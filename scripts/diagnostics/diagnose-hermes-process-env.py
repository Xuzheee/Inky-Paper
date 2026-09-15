"""Read only allowlisted Hermes path variables from the named desktop process."""
import ctypes
import json
import argparse
from ctypes import wintypes

parser = argparse.ArgumentParser()
parser.add_argument('pid', type=int, nargs='?', default=86288)
PID = parser.parse_args().pid
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
nt = ctypes.WinDLL('ntdll')
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
kernel.ReadProcessMemory.restype = wintypes.BOOL
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
nt.NtQueryInformationProcess.argtypes = [wintypes.HANDLE, wintypes.ULONG, ctypes.c_void_p, wintypes.ULONG, ctypes.c_void_p]
process = kernel.OpenProcess(0x0400 | 0x0010, False, PID)
if not process:
    raise ctypes.WinError(ctypes.get_last_error())

def read(address, size):
    buffer = ctypes.create_string_buffer(size)
    received = ctypes.c_size_t()
    if not kernel.ReadProcessMemory(process, address, buffer, size, ctypes.byref(received)):
        raise ctypes.WinError(ctypes.get_last_error())
    return buffer.raw[:received.value]

try:
    info = ctypes.create_string_buffer(48)
    if nt.NtQueryInformationProcess(process, 0, info, 48, None) != 0:
        raise RuntimeError('Process information not available')
    peb = int.from_bytes(info.raw[8:16], 'little')
    parameters = int.from_bytes(read(peb + 0x20, 8), 'little')
    environment = int.from_bytes(read(parameters + 0x80, 8), 'little')
    raw = bytearray()
    for offset in range(0, 262144, 2):
        raw.extend(read(environment + offset, 2))
        if len(raw) >= 4 and raw[-4:] == b'\x00\x00\x00\x00':
            break
    allowed = {'HERMES_HOME', 'HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_HERMES_ROOT', 'HERMES_DESKTOP_CWD', 'HERMES_DESKTOP_PYTHON', 'INKY_PAPER_CONNECTION_FILE', 'INKY_PAPER_TEST_DATA_DIR', 'APPDATA', 'LOCALAPPDATA'}
    output = {}
    for entry in raw.decode('utf-16-le').split('\x00'):
        key, sep, value = entry.partition('=')
        if sep and key in allowed:
            output[key] = value
    print(json.dumps({'pid': PID, 'pathVariables': output}, ensure_ascii=True))
finally:
    kernel.CloseHandle(process)
