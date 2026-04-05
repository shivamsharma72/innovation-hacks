from cryptography.fernet import Fernet, InvalidToken


def encrypt_secret(encryption_key: str, plaintext: str) -> str:
    f = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)
    return f.encrypt(plaintext.encode()).decode()


def decrypt_secret(encryption_key: str, ciphertext: str) -> str:
    f = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        raise ValueError("Invalid encryption key or corrupted ciphertext") from e
