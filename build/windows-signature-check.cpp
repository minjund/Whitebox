#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wintrust.h>
#include <softpub.h>
#include <stdio.h>

// Only a well-formed PE with an empty certificate table can be unsigned.
// A damaged embedded signature must never enter the unsigned release policy.
static bool unsignedPe(HANDLE file) {
    IMAGE_DOS_HEADER dos = {};
    DWORD read = 0;
    LARGE_INTEGER offset = {};
    if (!SetFilePointerEx(file, offset, nullptr, FILE_BEGIN) ||
        !ReadFile(file, &dos, sizeof(dos), &read, nullptr) || read != sizeof(dos) ||
        dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < sizeof(dos)) return false;
    offset.QuadPart = dos.e_lfanew;
    struct Header { DWORD signature; IMAGE_FILE_HEADER file; } header = {};
    if (!SetFilePointerEx(file, offset, nullptr, FILE_BEGIN) ||
        !ReadFile(file, &header, sizeof(header), &read, nullptr) || read != sizeof(header) ||
        header.signature != IMAGE_NT_SIGNATURE) return false;
    BYTE optional[sizeof(IMAGE_OPTIONAL_HEADER64)] = {};
    if (header.file.SizeOfOptionalHeader > sizeof(optional) ||
        !ReadFile(file, optional, header.file.SizeOfOptionalHeader, &read, nullptr) ||
        read != header.file.SizeOfOptionalHeader) return false;
    IMAGE_DATA_DIRECTORY certificate = {};
    if (*reinterpret_cast<WORD*>(optional) == IMAGE_NT_OPTIONAL_HDR64_MAGIC &&
        read == sizeof(IMAGE_OPTIONAL_HEADER64)) {
        const auto* pe = reinterpret_cast<IMAGE_OPTIONAL_HEADER64*>(optional);
        if (pe->NumberOfRvaAndSizes <= IMAGE_DIRECTORY_ENTRY_SECURITY) return false;
        certificate = pe->DataDirectory[IMAGE_DIRECTORY_ENTRY_SECURITY];
    } else if (*reinterpret_cast<WORD*>(optional) == IMAGE_NT_OPTIONAL_HDR32_MAGIC &&
        read == sizeof(IMAGE_OPTIONAL_HEADER32)) {
        const auto* pe = reinterpret_cast<IMAGE_OPTIONAL_HEADER32*>(optional);
        if (pe->NumberOfRvaAndSizes <= IMAGE_DIRECTORY_ENTRY_SECURITY) return false;
        certificate = pe->DataDirectory[IMAGE_DIRECTORY_ENTRY_SECURITY];
    } else return false;
    return certificate.VirtualAddress == 0 && certificate.Size == 0;
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 2) return 2;
    // Lock the verified bytes against modification while WinTrust reads them.
    HANDLE file = CreateFileW(argv[1], GENERIC_READ, FILE_SHARE_READ, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return 3;
    WINTRUST_FILE_INFO info = {};
    info.cbStruct = sizeof(info);
    info.pcwszFilePath = argv[1];
    info.hFile = file;
    WINTRUST_DATA trust = {};
    trust.cbStruct = sizeof(trust);
    trust.dwUIChoice = WTD_UI_NONE;
    trust.dwUnionChoice = WTD_CHOICE_FILE;
    trust.pFile = &info;
    trust.dwStateAction = WTD_STATEACTION_VERIFY;
    trust.dwProvFlags = WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT;
    GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    const LONG status = WinVerifyTrust(reinterpret_cast<HWND>(INVALID_HANDLE_VALUE), &policy, &trust);
    trust.dwStateAction = WTD_STATEACTION_CLOSE;
    const LONG closed = WinVerifyTrust(reinterpret_cast<HWND>(INVALID_HANDLE_VALUE), &policy, &trust);
    const bool noSignature = status == TRUST_E_NOSIGNATURE && unsignedPe(file);
    CloseHandle(file);
    if (closed != ERROR_SUCCESS) return 4;
    if (status == ERROR_SUCCESS) puts("Valid");
    else if (noSignature) puts("NotSigned");
    else if (status == TRUST_E_BAD_DIGEST) puts("HashMismatch");
    else puts("NotTrusted");
    return 0;
}
