# 10. A class and an object
class Dog:
    def __init__(self, name):
        self.name = name
        self.tricks = []

    def learn(self, trick):
        self.tricks.append(trick)


rex = Dog("Rex")
rex.learn("sit")
rex.learn("shake")
print(rex.name, "knows", len(rex.tricks), "tricks")
print(rex.tricks)
